import { logger } from "../../logger.js";
import type { OutgoingReply } from "../message.js";
import * as replies from "../replies.js";
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
 *
 * Until then it says so in plain language. The old wording ("reading from the
 * database isn't wired up yet (step 7)") was written for whoever was building
 * it, and testers were reading it as the bot's own voice — which made the whole
 * conversation feel like a debug console. What the tester needs to know is that
 * their totals aren't available yet; the step number belongs in the log line,
 * which is where it now is.
 */
const NOT_WIRED_YET = [
  "I can't pull your totals together just yet — that part of me is still being built. Shouldn't be long.",
  "Totals aren't ready on my side yet, sorry. Keep sending receipts and they'll be there when it is.",
];

const NOT_WIRED_YET_PIDGIN = [
  "I never fit show your total yet — dem still dey build that part. E no go tey.",
  "That one never ready for my side o. Keep sending receipt, e go dey there when I fit show am.",
];

export async function handleSummary(
  userId: number,
  period: Period,
  register: Register,
): Promise<OutgoingReply> {
  logger.info("[stub] summary — step 7 will read the database here", { userId, period, register });

  return {
    text: replies.pick("summary_stub", replies.byRegister(register, NOT_WIRED_YET, NOT_WIRED_YET_PIDGIN), userId),
  };
}
