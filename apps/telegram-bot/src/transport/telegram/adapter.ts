import { Bot, GrammyError, HttpError, InputFile, type Context } from "grammy";
import type { Message } from "grammy/types";
import type { IncomingMessage, MessageHandler, OutgoingReply } from "../../core/message.js";
import { isSupportedReceiptMedia } from "../../core/message.js";
import { env } from "../../config/env.js";
import { formatReport, setAdminNotifier, type AdminNotifier, type AdminReport } from "../../core/notify.js";
import { logger } from "../../logger.js";

/**
 * The Telegram transport adapter — thin and replaceable by design.
 *
 * Its whole job: turn an incoming update into a neutral IncomingMessage, hand it
 * to the core, and send back the OutgoingReply. It is the only file allowed to
 * know about file_ids, chat ids, photo size arrays or chat actions.
 *
 * Everything the core needs arrives as plain bytes and a mime type. The core
 * never sees a file_id (Section 2).
 */

/** getFile only serves files up to 20 MB. Anything larger cannot be downloaded at all. */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** A Telegram chat action expires after ~5s, so it has to be refreshed while OCR runs. */
const TYPING_REFRESH_MS = 4_000;

export interface TelegramAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createTelegramAdapter(token: string, handler: MessageHandler): TelegramAdapter {
  const bot = new Bot(token);

  bot.on("message", async (ctx) => {
    const message = ctx.message;
    const userId = message.from.id;

    // Everything here takes a beat — local OCR takes seconds, and understanding
    // a text message runs a local model. Show "typing" for all of it rather than
    // leaving the user staring at silence (Section 2). Sent before any work
    // starts, so it appears immediately.
    const stopTyping = keepTyping(ctx);

    try {
      const incoming = await toIncomingMessage(ctx, message, userId);
      if (!incoming) {
        logger.info("ignored update with no usable content", { userId });
        return;
      }

      logIncoming(incoming);
      const reply = await handler(incoming);
      if (reply) await send(ctx, reply);
    } catch (error) {
      // A bad upload must never take the process down (Section 8).
      logger.error("failed to handle message", { userId, error });
      await send(ctx, {
        text: "Something went wrong on my end with that one — mind sending it again?",
      }).catch(() => undefined);
    } finally {
      stopTyping();
    }
  });

  bot.catch((error) => {
    const cause = error.error;
    if (cause instanceof GrammyError) {
      logger.error("telegram rejected a request", { description: cause.description });
    } else if (cause instanceof HttpError) {
      logger.error("could not reach telegram", { error: cause });
    } else {
      logger.error("unhandled bot error", { error: cause });
    }
  });

  return {
    async start() {
      const me = await bot.api.getMe();
      logger.info("connected to telegram", { username: me.username, botId: me.id });

      const notifier = createAdminNotifier(bot);
      setAdminNotifier(notifier);
      logger.info(
        notifier
          ? "admin reports will go to the configured channel"
          : "ADMIN_CHAT_ID not set — admin reports go to the review log only",
      );
      // Resolves only when the bot stops; callers run it in the background.
      void bot.start({
        drop_pending_updates: env.TELEGRAM_DROP_PENDING_UPDATES,
        onStart: () => logger.info("long polling started — send the bot a message"),
      });
    },
    async stop() {
      setAdminNotifier(null);
      await bot.stop();
      logger.info("long polling stopped");
    },
  };
}

// ---------------------------------------------------------------------------
// update -> neutral message
// ---------------------------------------------------------------------------

async function toIncomingMessage(
  ctx: Context,
  message: Message,
  userId: number,
): Promise<IncomingMessage | null> {
  const receivedAt = new Date(message.date * 1000);

  if (message.photo) {
    // Telegram sends several sizes, ascending. Always take the largest — the
    // smaller ones are recompressed and will hurt OCR accuracy (Section 2).
    const largest = message.photo[message.photo.length - 1];
    return downloadMedia(ctx, userId, receivedAt, {
      fileId: largest.file_id,
      fileSize: largest.file_size,
      // Telegram does not label photo mime types; it always re-encodes to JPEG.
      mimeType: "image/jpeg",
      fileName: undefined,
      dimensions: `${largest.width}x${largest.height}`,
    });
  }

  if (message.document) {
    const document = message.document;
    return downloadMedia(ctx, userId, receivedAt, {
      fileId: document.file_id,
      fileSize: document.file_size,
      mimeType: document.mime_type,
      fileName: document.file_name,
    });
  }

  // Any other attachment — video, sticker, voice note, audio. Not a receipt, so
  // report it without spending a download on bytes we would only throw away.
  const other = otherAttachment(message);
  if (other) {
    return {
      userId,
      kind: "media",
      mimeType: other.mimeType,
      fileName: other.label,
      mediaError: "unsupported_type",
      receivedAt,
    };
  }

  if (message.text) {
    return { userId, kind: "text", text: message.text, receivedAt };
  }

  return null;
}

interface MediaRef {
  fileId: string;
  fileSize?: number;
  mimeType?: string;
  fileName?: string;
  dimensions?: string;
}

async function downloadMedia(
  ctx: Context,
  userId: number,
  receivedAt: Date,
  ref: MediaRef,
): Promise<IncomingMessage> {
  const base: IncomingMessage = {
    userId,
    kind: "media",
    mimeType: ref.mimeType,
    fileName: ref.fileName,
    receivedAt,
  };

  if (!isSupportedReceiptMedia(ref.mimeType)) {
    logger.info("skipping download of unsupported media", { userId, mimeType: ref.mimeType });
    return { ...base, mediaError: "unsupported_type" };
  }

  if (ref.fileSize !== undefined && ref.fileSize > MAX_DOWNLOAD_BYTES) {
    logger.warn("file exceeds telegram's download limit", { userId, bytes: ref.fileSize });
    return { ...base, mediaError: "too_large" };
  }

  try {
    const file = await ctx.api.getFile(ref.fileId);
    if (!file.file_path) throw new Error("getFile returned no file_path");

    const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`file download returned ${response.status}`);

    const fileBytes = Buffer.from(await response.arrayBuffer());
    // Telegram keeps the original; the core stores this handle instead of a copy.
    return { ...base, fileBytes, transportRef: ref.fileId };
  } catch (error) {
    logger.error("could not download file", { userId, error });
    return { ...base, mediaError: "download_failed" };
  }
}


function otherAttachment(message: Message): { mimeType?: string; label: string } | null {
  if (message.video) return { mimeType: message.video.mime_type, label: "video" };
  if (message.animation) return { mimeType: message.animation.mime_type, label: "animation" };
  if (message.audio) return { mimeType: message.audio.mime_type, label: "audio" };
  if (message.voice) return { mimeType: message.voice.mime_type, label: "voice note" };
  if (message.video_note) return { mimeType: undefined, label: "video note" };
  if (message.sticker) return { mimeType: undefined, label: "sticker" };
  return null;
}

// ---------------------------------------------------------------------------
// admin reports
// ---------------------------------------------------------------------------

/** Telegram captions cap at 1024 characters. */
const MAX_CAPTION = 1024;

/**
 * Delivers an admin report to the private channel in ADMIN_CHAT_ID.
 *
 * Returns a no-op when that isn't configured, so the bot runs perfectly well
 * without one — reports then live only in the review log.
 */
function createAdminNotifier(bot: Bot): AdminNotifier | null {
  const chatId = env.ADMIN_CHAT_ID;
  if (!chatId) return null;

  return async (report: AdminReport): Promise<void> => {
    const text = formatReport(report);

    if (!report.image) {
      await bot.api.sendMessage(chatId, truncate(text, 4000));
      return;
    }

    const file = new InputFile(report.image, report.imageName ?? "receipt");

    // The picture is the point, so send it even if the detail has to follow
    // separately — a caption cannot carry a full OCR dump.
    if (text.length <= MAX_CAPTION) {
      await bot.api.sendPhoto(chatId, file, { caption: text });
      return;
    }

    await bot.api.sendPhoto(chatId, file, { caption: truncate(report.title, MAX_CAPTION) });
    await bot.api.sendMessage(chatId, truncate(text, 4000));
  };
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

// ---------------------------------------------------------------------------
// telegram side effects
// ---------------------------------------------------------------------------

async function send(ctx: Context, reply: OutgoingReply): Promise<void> {
  await ctx.reply(reply.text);
}

/** Sends "typing" now and keeps refreshing it until the returned function is called. */
function keepTyping(ctx: Context): () => void {
  const fire = (): void => {
    void ctx.replyWithChatAction("typing").catch(() => undefined);
  };
  fire();
  const timer = setInterval(fire, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}

function logIncoming(message: IncomingMessage): void {
  if (message.kind === "text") {
    logger.info("received text", { userId: message.userId, text: message.text });
    return;
  }
  logger.info("received media", {
    userId: message.userId,
    mimeType: message.mimeType,
    fileName: message.fileName,
    bytes: message.fileBytes?.length,
    mediaError: message.mediaError,
  });
}
