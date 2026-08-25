import { logger } from "../../logger.js";
import type { Turn } from "../conversation.js";
import { isBareFollowUp } from "../intent/register.js";
import { generateStructured, isNluEnabled, loadModel } from "./model.js";
import { composeReply } from "./respond.js";
import {
  CATEGORY_ANSWER_SCHEMA,
  INTERPRETATION_SCHEMA,
  parseCategoryAnswer,
  parseInterpretation,
  type CategoryAnswer,
  type Interpretation,
} from "./schema.js";
import {
  CATEGORY_SYSTEM_PROMPT,
  INTENT_SYSTEM_PROMPT,
  categoryUserPrompt,
  followUpUserPrompt,
  intentUserPrompt,
  lastBotReply,
} from "./prompt.js";

export { disposeNlu, isNluEnabled } from "./model.js";
export type { Interpretation, NluIntent, NluConfidence, SmallTalkKind } from "./schema.js";

/**
 * Natural-language understanding.
 *
 * This is the whole surface the application sees: give it a message, get back a
 * structured interpretation or null. What the model may return is fixed by
 * schema.ts and validated after generation.
 *
 * Returning null is normal and expected — the model may be disabled, still
 * loading, timed out, or have produced something that failed validation. The
 * caller falls back to the deterministic matcher in those cases.
 */

/**
 * Loads the model AND runs one throwaway interpretation through it.
 *
 * Loading alone is not enough: the ~1,300-token system prompt is only evaluated
 * on first use, so without this the first real user message paid a 3-4 second
 * penalty. Spending it at startup instead means the prompt is already in the KV
 * cache and every real message costs only its own tokens.
 */
export async function warmUpNlu(): Promise<boolean> {
  if (!(await loadModel())) return false;

  const started = Date.now();
  await interpretMessage("hello");

  // The reply session has its own system prompt and its own KV cache, so it
  // needs its own throwaway request. Without this the first conversational
  // message paid ~2s to evaluate a prompt every later one got for free.
  await composeReply({ text: "what can you do", situation: "capability" });

  logger.info("NLU warm — both system prompts cached", { ms: Date.now() - started });
  return true;
}

/** What a message means when it cannot be read at all: honestly, nothing. */
const NOT_UNDERSTOOD: Interpretation = {
  intent: "unclear",
  confidence: "high",
  small_talk_kind: "none",
  unclear_reason: "not_understood",
  period: "none",
};

export async function interpretMessage(
  text: string,
  history: readonly Turn[] = [],
): Promise<Interpretation | null> {
  const previous = lastBotReply(history);

  // "why not", "that's it?" — nothing in the message itself to read. Asking the
  // model to label it alone produces a guess, so it is never asked.
  if (isBareFollowUp(text)) {
    if (previous === null) return NOT_UNDERSTOOD;

    // Conversation is all this path may conclude. A reaction is not a request:
    // "why not" cannot mean "show me my totals" or "delete that", whatever the
    // model makes of it, and both readings were observed. Either way the reply
    // is written with the transcript in front of it, so nothing is lost by
    // treating an unresolvable reaction as one the bot didn't follow.
    const resolved = await label(followUpUserPrompt(text, previous));
    return resolved?.intent === "small_talk" ? resolved : NOT_UNDERSTOOD;
  }

  const first = await label(intentUserPrompt(text));
  if (!first) return null;

  // A message that stands on its own is finished here — the overwhelming
  // majority of them. Only a genuine "I couldn't place this" is worth a second
  // inference, and only when there is something for it to be answering.
  if (!needsContext(first, text) || previous === null) return first;

  const second = await label(followUpUserPrompt(text, previous));
  if (!second || !isUsableFollowUp(second)) return first;

  logger.info("follow-up resolved with context", {
    text,
    was: first.intent,
    now: second.intent,
  });
  return second;
}

/**
 * What the second look is allowed to conclude.
 *
 * Conversation, freely: "that's it?" after a list of abilities is chitchat, and
 * nothing is at stake in saying so.
 *
 * A request, only if the model is certain. Left ungated, this was the same
 * contamination in miniature — the bot's last line mentioned spending, so "why
 * not" and "why now" came back as summary requests at medium confidence, which
 * is precisely the guessing the honest "I didn't follow that" exists to avoid.
 * A real follow-up request ("and last month?") reads as high confidence and
 * still gets through.
 */
function isUsableFollowUp(interpretation: Interpretation): boolean {
  if (interpretation.intent === "unclear") return false;
  if (interpretation.intent === "small_talk") return true;
  return interpretation.confidence === "high";
}

/**
 * Which readings are worth a second look.
 *
 * "I didn't follow that" is the honest answer to a fragment, and a fragment is
 * exactly what a follow-up looks like in isolation. An out-of-scope reading is
 * left alone: the model understood the message fine, and context won't change
 * that the bot doesn't do budgets.
 */
function needsContext(interpretation: Interpretation, text: string): boolean {
  if (interpretation.intent !== "unclear") return false;
  if (interpretation.unclear_reason !== "not_understood") return false;
  // A long message that couldn't be placed wasn't short of context.
  return text.trim().split(/\s+/).length <= 8;
}

async function label(userPrompt: string): Promise<Interpretation | null> {
  if (!isNluEnabled()) return null;

  const raw = await generateStructured(
    "interpretation",
    INTERPRETATION_SCHEMA,
    INTENT_SYSTEM_PROMPT,
    userPrompt,
  );
  if (raw === null) return null;

  const interpretation = parseInterpretation(raw);
  if (!interpretation) {
    logger.warn("nlu returned output that failed validation", { raw });
    return null;
  }
  return interpretation;
}

/**
 * Reads a free-text answer to "which category is this?" — used only when the
 * application has already established that a category question is outstanding.
 * The model maps words to one of the fixed categories; it does not decide
 * whether to accept the answer, store it, or ask again.
 */
export async function interpretCategoryAnswer(
  text: string,
  merchant: string | null,
): Promise<CategoryAnswer | null> {
  if (!isNluEnabled()) return null;

  const raw = await generateStructured(
    "category",
    CATEGORY_ANSWER_SCHEMA,
    CATEGORY_SYSTEM_PROMPT,
    categoryUserPrompt(text, merchant),
  );
  if (raw === null) return null;

  const answer = parseCategoryAnswer(raw);
  if (!answer) {
    logger.warn("nlu category answer failed validation", { raw });
    return null;
  }
  return answer;
}
