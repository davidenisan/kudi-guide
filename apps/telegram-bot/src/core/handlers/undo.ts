import { logger } from "../../logger.js";
import type { OutgoingReply } from "../message.js";
import * as replies from "../replies.js";
import type { Register } from "../understand.js";

/**
 * Undo handler — STUB (step 7).
 *
 * The real one finds the most recent valid transaction for this user (excluding
 * already-undone and rejected ones) and removes it safely. Which transaction
 * that is, and whether it may be removed, is decided here from the database —
 * never by the model, which cannot name a transaction at all.
 *
 * The stub says so as a person would; the step number lives in the log line
 * rather than in the tester's chat window. What it must not do is imply the
 * entry went anywhere, so every phrasing below is explicit that nothing moved.
 */
const NOT_WIRED_YET = [
  "I can't take entries back out yet — that bit's still being built, so nothing's changed on my side.",
  "Removing things isn't working on my end just yet, so that one's still there. It's being worked on.",
];

const NOT_WIRED_YET_PIDGIN = [
  "I never fit comot entry yet — dem still dey build am, so nothing change.",
  "To remove am never work for my side, so e still dey there. Dem dey work on am.",
];

export async function handleUndo(userId: number, register: Register): Promise<OutgoingReply> {
  logger.info("[stub] undo — step 7 will remove the transaction here", { userId, register });

  return {
    text: replies.pick("undo_stub", replies.byRegister(register, NOT_WIRED_YET, NOT_WIRED_YET_PIDGIN), userId),
  };
}

/** Confirmed undo, arriving after the user answered a confirm-before-acting question. */
export async function handleConfirmedUndo(
  userId: number,
  transactionId: string | null,
): Promise<OutgoingReply> {
  logger.info("[stub] confirmed undo — step 7 will remove the transaction here", { userId, transactionId });

  return {
    text: "Got it — though I can't actually remove it yet, that part's still being built. Nothing's changed.",
  };
}
