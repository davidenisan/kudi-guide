import { logger } from "../logger.js";
import { ACT_THRESHOLD, classifyIntent, smallTalkFlavor } from "./intent/classify.js";
import type { Intent } from "./intent/patterns.js";
import { expandEmoji } from "./intent/normalize.js";
import { detectRegister, isJunkText } from "./intent/register.js";
import { interpretMessage, isNluEnabled } from "./nlu/index.js";
import type { NluConfidence } from "./nlu/schema.js";

/**
 * The boundary between understanding and doing.
 *
 * The local model reads the message and says what it thinks it means. This
 * module then decides — in ordinary application code — what that entitles the
 * bot to do. The model has no say in that: it never sees a threshold, never
 * learns whether its answer was acted on, and cannot express "delete this".
 *
 * Everything downstream of here is deterministic.
 */

export type Register = "pidgin" | "standard";
export type SmallTalkKind = "greeting" | "gratitude" | "acknowledgement" | "capability";
export type Period = "this_month" | "last_month" | "today" | null;
export type UnclearReason = "out_of_scope" | "not_understood";

export interface Understanding {
  intent: Intent;
  /**
   * Whether the application may act directly or must ask first. Decided here,
   * from confidence — never by the model.
   */
  action: "act" | "confirm";
  smallTalkKind: SmallTalkKind;
  register: Register;
  period: Period;
  /** Set when intent is unclear: did we not follow them, or do we not do that? */
  unclearReason: UnclearReason;
  /** Which layer produced this, for the review log. */
  source: "llm" | "patterns" | "junk-filter";
  confidence: string;
}

/**
 * Confidence-to-permission, the one place it is decided.
 *
 * Undo is the asymmetric case: acting wrongly destroys a real transaction,
 * while asking wrongly costs one message. So undo requires the model to be
 * certain, and anything less becomes a question (Section 3).
 *
 * The extra floor exists because the model is not a reliable judge of its own
 * certainty — during testing it returned "high" for a bare "wrong", which would
 * have deleted a real entry. A one-word message never carries enough context to
 * identify a transaction, whatever the model says about it, so it always asks.
 * This is application policy, deliberately not delegated.
 */
function actionFor(intent: Intent, confidence: NluConfidence, text: string): "act" | "confirm" {
  if (intent !== "request_undo") return "act";
  if (confidence !== "high") return "confirm";

  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 ? "act" : "confirm";
}

export async function understand(text: string): Promise<Understanding> {
  // Register is a property of the words themselves, not something to interpret.
  const register = detectRegister(text);

  // A bare "👍" is a real message that happens to contain no letters. Turning
  // known emoji into the word they stand for lets both the junk filter and the
  // model see what is actually there.
  const prepared = expandEmoji(text);

  // Keyboard mash has no meaning to read, and a model forced to pick an intent
  // for it will pick one — it answered "spending summary" for "....". Junk is
  // settled here, which also saves a second of inference on every stray tap.
  if (isJunkText(prepared)) {
    return {
      intent: "unclear",
      action: "act",
      smallTalkKind: "greeting",
      register,
      period: null,
      unclearReason: "not_understood",
      source: "junk-filter",
      confidence: "n/a",
    };
  }

  if (isNluEnabled()) {
    const interpretation = await interpretMessage(prepared);

    if (interpretation) {
      // A summary guess the model itself calls low-confidence is not worth
      // acting on; ask instead of returning numbers for a misread question.
      const intent =
        interpretation.intent === "request_summary" && interpretation.confidence === "low"
          ? "unclear"
          : interpretation.intent;

      return {
        intent,
        action: actionFor(intent, interpretation.confidence, text),
        smallTalkKind: smallTalkKindFrom(interpretation.small_talk_kind),
        register,
        period: interpretation.period === "none" ? null : interpretation.period,
        unclearReason: interpretation.unclear_reason === "out_of_scope" ? "out_of_scope" : "not_understood",
        source: "llm",
        confidence: interpretation.confidence,
      };
    }

    logger.info("nlu unavailable for this message — using pattern fallback");
  }

  return fromPatterns(prepared, register);
}

/**
 * The deterministic fallback, used when the model is disabled, still loading,
 * timed out, or produced something invalid. Deliberately frozen: it exists so
 * the bot degrades instead of breaking, not as a second system to grow.
 */
function fromPatterns(text: string, register: Register): Understanding {
  const classification = classifyIntent(text);
  const confident = classification.confidence >= ACT_THRESHOLD;

  return {
    intent: classification.intent,
    action: classification.intent === "request_undo" && !confident ? "confirm" : "act",
    smallTalkKind: smallTalkFlavor(text),
    register,
    period: null,
    // The matcher has no way to tell "I don't follow" from "I don't do that",
    // so degraded mode always takes the humbler of the two.
    unclearReason: "not_understood",
    source: "patterns",
    confidence: classification.confidence.toFixed(2),
  };
}

function smallTalkKindFrom(kind: string): SmallTalkKind {
  switch (kind) {
    case "gratitude":
    case "acknowledgement":
    case "capability":
      return kind;
    default:
      return "greeting";
  }
}
