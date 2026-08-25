import { getOrCreateUser, getPendingCategoryTransaction } from "../db/index.js";
import { logger } from "../logger.js";
import {
  recentTurns,
  rememberBotReply,
  rememberUserMessage,
  setPendingUndo,
  takePendingUndo,
} from "./conversation.js";
import { handleCategoryReply } from "./handlers/category.js";
import { handleReceipt } from "./handlers/receipt.js";
import { handleSummary } from "./handlers/summary.js";
import { handleConfirmedUndo, handleUndo } from "./handlers/undo.js";
import { converse } from "./converse.js";
import { classifyConfirmation } from "./intent/classify.js";
import { parseCommand } from "./intent/normalize.js";
import type { IncomingMessage, MessageHandler, OutgoingReply } from "./message.js";
import { isSupportedReceiptMedia } from "./message.js";
import * as replies from "./replies.js";
import { recordForReview } from "./review-log.js";
import { understand } from "./understand.js";

/**
 * The message router (Section 2).
 *
 *   media                        -> receipt pipeline
 *   text, pending category reply -> category correction handler
 *   text, intent request_summary -> summary handler
 *   text, intent request_undo    -> undo handler
 *   text, intent small_talk      -> conversational reply
 *   text, intent unclear         -> conversational fallback
 *
 * Plain text is classified, not keyword-matched. Nothing in this file — or
 * anywhere below it — knows the transport is Telegram.
 */
export const router: MessageHandler = async (message: IncomingMessage): Promise<OutgoingReply | null> => {
  // A user record is created on first contact. No signup, no verification.
  await getOrCreateUser(message.userId);

  const reply = message.kind === "media" ? await routeMedia(message) : await routeText(message);

  // Both sides of the exchange are kept for the next few minutes, so the next
  // message can be read in the light of this one. Recorded after handling, not
  // before, so nothing downstream sees the current message twice.
  rememberUserMessage(message.userId, describeForTranscript(message));
  if (reply) rememberBotReply(message.userId, reply.text);

  return reply;
};

/**
 * What a message looks like in the transcript. Media has no text, but "they
 * sent a receipt" is exactly the context that makes the next message ("did you
 * get it?") readable.
 */
function describeForTranscript(message: IncomingMessage): string {
  if (message.kind === "text") return message.text ?? "";
  return isSupportedReceiptMedia(message.mimeType) ? "[sent a receipt image]" : "[sent a file]";
}

// ---------------------------------------------------------------------------

async function routeMedia(message: IncomingMessage): Promise<OutgoingReply> {
  const userId = message.userId;

  if (message.fileBytes && isSupportedReceiptMedia(message.mimeType)) {
    return handleReceipt(message);
  }

  // Everything below is Section 8's graceful handling of media we can't read.
  await recordForReview("rejected-receipt", {
    userId,
    reason: message.mediaError ?? "unsupported",
    mimeType: message.mimeType,
    fileName: message.fileName,
  });

  logger.info("media not routed to the pipeline", {
    userId,
    mimeType: message.mimeType,
    reason: message.mediaError,
  });

  switch (message.mediaError) {
    case "too_large":
      return { text: replies.pick("too_large", replies.MEDIA_TOO_LARGE, userId) };
    case "download_failed":
      return { text: replies.pick("failed", replies.MEDIA_FAILED, userId) };
    default:
      return { text: replies.pick("unsupported", replies.UNSUPPORTED_MEDIA, userId) };
  }
}

async function routeText(message: IncomingMessage): Promise<OutgoingReply | null> {
  const userId = message.userId;
  const text = message.text?.trim() ?? "";

  if (text === "") return null;

  // 1. Slash commands. Undocumented conveniences, not the interface (Section 3),
  //    but an explicit command should win over any pending question.
  const command = parseCommand(text);
  if (command) return routeCommand(command, userId);

  // 2. A confirm-before-undo question is outstanding. Read-once: whatever the
  //    answer is, the question closes here.
  const pendingUndo = takePendingUndo(userId);
  if (pendingUndo) {
    const answer = classifyConfirmation(text);
    logger.info("undo confirmation answered", { userId, answer, text });

    if (answer === "yes") return handleConfirmedUndo(userId, pendingUndo.transactionId);
    if (answer === "no") return { text: replies.pick("undo_aborted", replies.UNDO_ABORTED, userId) };
    // Unclear. Nothing is removed; fall through and read the message fresh.
    logger.info("unclear confirmation — nothing removed", { userId });
  }

  // 3. A pending category question takes the next plain-text reply (Section 6).
  //    This must come before classification, or a one-word answer like
  //    "Transport" would be read as unclear.
  const pendingCategory = await getPendingCategoryTransaction(userId);
  if (pendingCategory) {
    return handleCategoryReply(userId, text, pendingCategory);
  }

  // 4. Understanding. The local model reads the message — in the light of the
  //    last few turns, so follow-ups and reactions are readable — and this code
  //    decides what that permits. See core/understand.ts for the split.
  const history = recentTurns(userId);
  const reading = await understand(text, history);
  logger.info("understood text", {
    userId,
    intent: reading.intent,
    action: reading.action,
    confidence: reading.confidence,
    register: reading.register,
    source: reading.source,
  });

  // Every inbound text, with the exact codepoints received. Section 10 wants
  // per-tester activity anyway, and when a reply looks wrong this is the
  // difference between reading the actual bytes and guessing at them.
  await recordForReview("messages", {
    userId,
    text,
    codepoints: [...text].map((character) => character.codePointAt(0)?.toString(16)).join(" "),
    intent: reading.intent,
    source: reading.source,
  });

  const { register } = reading;

  switch (reading.intent) {
    case "request_summary":
      // The period is a structured hint. Turning it into dates, querying and
      // adding anything up stays entirely in application code.
      return handleSummary(userId, reading.period, register);

    case "request_undo":
      if (reading.action === "act") {
        return handleUndo(userId, register);
      }
      // Section 3: a misread message must never quietly delete a transaction.
      setPendingUndo(userId, null);
      logger.info("undo not certain enough to act — confirming first", {
        userId,
        confidence: reading.confidence,
      });
      return {
        text: replies.pick(
          "undo_confirm",
          replies.byRegister(register, replies.UNDO_CONFIRM_GENERIC, replies.UNDO_CONFIRM_PIDGIN),
          userId,
        ),
      };

    case "small_talk":
      return { text: await converse({ userId, text, userName: message.userName, reading, history }) };

    case "unclear":
      // Section 3: log every unclear message, now with which layer produced it.
      await recordForReview("unclear", {
        userId,
        text,
        reason: reading.unclearReason,
        source: reading.source,
        confidence: reading.confidence,
      });

      // Understood-but-unsupported gets a straight answer about what the bot
      // does; genuinely-didn't-follow gets Section 3's question. Both are
      // written to the message in front of them — see core/converse.ts.
      return { text: await converse({ userId, text, userName: message.userName, reading, history }) };
  }
}

async function routeCommand(command: string, userId: number): Promise<OutgoingReply | null> {
  logger.info("slash command", { userId, command });

  switch (command) {
    case "start":
      return { text: replies.pick("start", replies.START, userId) };
    case "help":
      return { text: replies.pick("capability", replies.CAPABILITY, userId) };
    case "summary":
      return handleSummary(userId, null, "standard");
    case "undo":
      // An explicit command is unambiguous — no confirmation needed.
      return handleUndo(userId, "standard");
    default:
      await recordForReview("unclear", { userId, text: `/${command}`, source: "command" });
      return { text: replies.pick("unclear", replies.UNCLEAR, userId) };
  }
}
