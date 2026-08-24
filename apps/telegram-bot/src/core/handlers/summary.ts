import { logger } from "../../logger.js";
import type { OutgoingReply } from "../message.js";
import type { Period, Register } from "../understand.js";

/**
 * Summary handler — STUB (step 7).
 *
 * `period` arrives as a structured hint ("this_month"), never as dates. Turning
 * it into a range, querying, and adding anything up is this layer's job and
 * stays in deterministic code — the model is not involved in any arithmetic.
 *
 * The real one reads getMonthlySummary() and renders it in the Section 9 shape:
 * totals and nothing else, with no observations about where the money went.
 */
export async function handleSummary(
  userId: number,
  period: Period,
  register: Register,
): Promise<OutgoingReply> {
  logger.info("[stub] summary", { userId, period, register });

  return {
    text:
      "📊 Understood as a spending summary request" +
      `${period ? ` for ${period.replace("_", " ")}` : ""}` +
      " — reading from the database isn't wired up yet (step 7).",
  };
}
