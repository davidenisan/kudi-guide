import { logger } from "../../logger.js";
import type { Transaction } from "../types.js";
import type { OutgoingReply } from "../message.js";

/**
 * Category correction handler — STUB (step 6).
 *
 * The real one validates the reply against the fixed category list, re-asks once
 * if it doesn't match, defaults to Others after that rather than looping, and
 * remembers the merchant->category choice for this user (Section 6).
 *
 * What matters for step 3 is that a pending category question intercepts the
 * next plain-text message *before* intent classification sees it — otherwise a
 * one-word answer like "Transport" would be classified as unclear.
 */
export async function handleCategoryReply(
  userId: number,
  text: string,
  pending: Transaction,
): Promise<OutgoingReply> {
  logger.info("[stub] category reply", { userId, answer: text, transactionId: pending.id });

  return {
    text: [
      `🏷  Read "${text}" as a category answer for the ₦? ${pending.merchant ?? "unknown"} entry.`,
      "Validation and learning aren't built yet (step 6).",
    ].join("\n"),
  };
}
