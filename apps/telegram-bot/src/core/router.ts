import { getOrCreateUser, getPendingCategoryTransaction } from "../db/index.js";
import { logger } from "../logger.js";
import { setPendingUndo, takePendingUndo } from "./conversation.js";
import { handleCategoryReply } from "./handlers/category.js";
import { handleReceipt } from "./handlers/receipt.js";
import { handleSummary } from "./handlers/summary.js";
import { handleConfirmedUndo, handleUndo } from "./handlers/undo.js";
import { classifyConfirmation } from "./intent/classify.js";
import { parseCommand } from "./intent/normalize.js";
import type { IncomingMessage, MessageHandler, OutgoingReply } from "./message.js";
import { isSupportedReceiptMedia } from "./message.js";
import * as replies from "./replies.js";
import { recordForReview } from "./review-log.js";
import { composeReply, type ReplyContext } from "./nlu/respond.js";
import { understand, type Understanding } from "./understand.js";

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

  return message.kind === "media" ? routeMedia(message) : routeText(message);
};

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

  // 4. Understanding. The local model reads the message; this code decides what
  //    that permits. See core/understand.ts for the split.
  const reading = await understand(text);
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
      return {
        text: await conversationalReply(
          { text, name: message.userName, situation: reading.smallTalkKind },
          () => smallTalkReply(reading, userId),
        ),
      };

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
      // does; genuinely-didn't-follow gets Section 3's question.
      return {
        text: await conversationalReply(
          { text, name: message.userName, situation: reading.unclearReason },
          () =>
            reading.unclearReason === "out_of_scope"
              ? replies.pick(
                  "out_of_scope",
                  replies.byRegister(register, replies.OUT_OF_SCOPE, replies.OUT_OF_SCOPE_PIDGIN),
                  userId,
                )
              : replies.pick("unclear", replies.byRegister(register, replies.UNCLEAR, replies.UNCLEAR_PIDGIN), userId),
        ),
      };
  }
}

/**
 * Replies where there is no figure to get wrong, so the model writes them.
 *
 * Anything carrying an amount, merchant, category or total goes through a
 * template instead — those are built from the database and must be exact. Here
 * there is no fact at stake, and fixed strings were what made the bot read like
 * a phone tree.
 *
 * The fallback runs whenever generation is unavailable, too slow, or trips a
 * guardrail, so a failure costs liveliness and nothing else.
 */
async function conversationalReply(context: ReplyContext, fallback: () => string): Promise<string> {
  const generated = await composeReply(context);
  return generated ?? fallback();
}

/** Small talk is one intent but four different things worth saying back. */
function smallTalkReply(reading: Understanding, userId: number): string {
  const { register } = reading;

  switch (reading.smallTalkKind) {
    case "gratitude":
      return replies.pick("gratitude", replies.byRegister(register, replies.GRATITUDE, replies.GRATITUDE_PIDGIN), userId);
    case "acknowledgement":
      return replies.pick(
        "ack",
        replies.byRegister(register, replies.ACKNOWLEDGEMENT, replies.ACKNOWLEDGEMENT_PIDGIN),
        userId,
      );
    case "capability":
      // Kept in standard English — it's the one reply carrying real information.
      return replies.pick("capability", replies.CAPABILITY, userId);
    case "greeting":
      return replies.pick("small_talk", replies.byRegister(register, replies.SMALL_TALK, replies.SMALL_TALK_PIDGIN), userId);
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
