import { logger } from "../../logger.js";
import type { OutgoingReply } from "../message.js";
import type { Register } from "../understand.js";

/**
 * Undo handler — STUB (step 7).
 *
 * The real one finds the most recent valid transaction for this user (excluding
 * already-undone and rejected ones) and removes it safely. Which transaction
 * that is, and whether it may be removed, is decided here from the database —
 * never by the model, which cannot name a transaction at all.
 */
export async function handleUndo(userId: number, register: Register): Promise<OutgoingReply> {
  logger.info("[stub] undo", { userId, register });

  return {
    text: "↩️  Understood as an undo request — removing from the database isn't wired up yet (step 7).",
  };
}

/** Confirmed undo, arriving after the user answered a confirm-before-acting question. */
export async function handleConfirmedUndo(
  userId: number,
  transactionId: string | null,
): Promise<OutgoingReply> {
  logger.info("[stub] confirmed undo", { userId, transactionId });

  return {
    text: "↩️  Confirmed — but removing from the database isn't wired up yet (step 7).",
  };
}
