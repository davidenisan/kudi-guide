import { CATEGORIES, type Category } from "../types.js";

/**
 * The contract between the language model and the application.
 *
 * The model's ONLY job is to read a message and fill this in. It does not decide
 * what happens next, does not touch data, does not compute anything, and never
 * produces text that reaches the user. Everything it returns is an enum member
 * this file defines, and every value is validated in code after the fact —
 * the grammar constrains generation, and `parseInterpretation` refuses anything
 * that still doesn't fit.
 *
 * Note what is deliberately absent: no amount, no merchant, no transaction id,
 * no free text. The model is never in a position to invent a number.
 */

export const INTENTS = [
  "request_summary",
  "request_undo",
  "small_talk",
  "unclear",
] as const;

export type NluIntent = (typeof INTENTS)[number];

/**
 * Coarse buckets rather than a number. Small models produce wildly uncalibrated
 * numeric confidence; they are far more reliable at a three-way judgement. The
 * mapping from these buckets to "act" or "ask first" lives in application code,
 * not here.
 */
export const CONFIDENCES = ["high", "medium", "low"] as const;
export type NluConfidence = (typeof CONFIDENCES)[number];

/**
 * "chitchat" is the bucket that was missing, and its absence is most of why the
 * bot read like a phone tree. Everything conversational that is not one of the
 * other four — a complaint about the bot, a joke, "how was your day", "you're
 * boring" — has no label to land on, and `smallTalkKindFrom` defaulted it to
 * greeting. So a person saying the bot was no fun to talk to got waved at.
 */
export const SMALL_TALK_KINDS = [
  "greeting",
  "gratitude",
  "acknowledgement",
  "capability",
  "chitchat",
  "none",
] as const;
export type SmallTalkKind = (typeof SMALL_TALK_KINDS)[number];

/** A structured hint, not a date range. The application computes actual dates. */
export const PERIODS = ["this_month", "last_month", "today", "none"] as const;
export type NluPeriod = (typeof PERIODS)[number];

/**
 * Why a message didn't map to an intent. "I didn't follow you" and "I followed
 * you, but I don't do that" are different things to say, and saying the wrong
 * one is what makes a bot feel obtuse — asking "did you want your spending
 * summary?" after someone asks about the weather pretends to be confused.
 */
export const UNCLEAR_REASONS = ["out_of_scope", "not_understood", "none"] as const;
export type NluUnclearReason = (typeof UNCLEAR_REASONS)[number];

export interface Interpretation {
  intent: NluIntent;
  confidence: NluConfidence;
  small_talk_kind: SmallTalkKind;
  unclear_reason: NluUnclearReason;
  period: NluPeriod;
}

/** The JSON schema the model's output grammar is built from. */
export const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    intent: { enum: [...INTENTS] },
    confidence: { enum: [...CONFIDENCES] },
    small_talk_kind: { enum: [...SMALL_TALK_KINDS] },
    unclear_reason: { enum: [...UNCLEAR_REASONS] },
    period: { enum: [...PERIODS] },
  },
  required: ["intent", "confidence", "small_talk_kind", "unclear_reason", "period"],
} as const;

/** Category answers are a separate, narrower question with its own prompt. */
export const CATEGORY_ANSWER_SCHEMA = {
  type: "object",
  properties: {
    category: { enum: [...CATEGORIES, "none"] },
    confidence: { enum: [...CONFIDENCES] },
  },
  required: ["category", "confidence"],
} as const;

export interface CategoryAnswer {
  category: Category | null;
  confidence: NluConfidence;
}

// ---------------------------------------------------------------------------
// validation — defence in depth behind the grammar
// ---------------------------------------------------------------------------

function isMember<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * Accepts the model's output only if every field is a known enum member.
 * Returns null otherwise, which sends the caller to the deterministic fallback.
 */
export function parseInterpretation(value: unknown): Interpretation | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (!isMember(INTENTS, raw.intent)) return null;
  if (!isMember(CONFIDENCES, raw.confidence)) return null;

  return {
    intent: raw.intent,
    confidence: raw.confidence,
    small_talk_kind: isMember(SMALL_TALK_KINDS, raw.small_talk_kind) ? raw.small_talk_kind : "none",
    unclear_reason: isMember(UNCLEAR_REASONS, raw.unclear_reason) ? raw.unclear_reason : "not_understood",
    period: isMember(PERIODS, raw.period) ? raw.period : "none",
  };
}

export function parseCategoryAnswer(value: unknown): CategoryAnswer | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (!isMember(CONFIDENCES, raw.confidence)) return null;
  if (raw.category === "none") return { category: null, confidence: raw.confidence };
  if (!isMember(CATEGORIES, raw.category)) return null;

  return { category: raw.category as Category, confidence: raw.confidence };
}
