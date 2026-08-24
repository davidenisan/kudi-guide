import { logger } from "../../logger.js";
import { generateStructured, isNluEnabled, loadModel } from "./model.js";
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
  intentUserPrompt,
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
  logger.info("NLU warm — system prompt cached", { ms: Date.now() - started });
  return true;
}

export async function interpretMessage(text: string): Promise<Interpretation | null> {
  if (!isNluEnabled()) return null;

  const raw = await generateStructured(
    "interpretation",
    INTERPRETATION_SCHEMA,
    INTENT_SYSTEM_PROMPT,
    intentUserPrompt(text),
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
