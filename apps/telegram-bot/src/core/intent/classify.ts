import { containsInOrder } from "./fuzzy.js";
import { tokenize } from "./normalize.js";
import {
  ACKNOWLEDGEMENT_PATTERNS,
  AFFIRMATIVE_PATTERNS,
  CAPABILITY_PATTERNS,
  GRATITUDE_PATTERNS,
  NEGATIVE_PATTERNS,
  PATTERNS_BY_INTENT,
  WEIGHT,
  type Intent,
  type Pattern,
} from "./patterns.js";

export type { Intent } from "./patterns.js";

/**
 * Local intent classification (Section 3, approach 1).
 *
 * Deterministic, instant, free and debuggable — no model, cloud or otherwise.
 * Every classification carries a confidence and the patterns that produced it,
 * so a wrong answer can be explained and fixed rather than guessed at.
 *
 * The governing rule is "ask, don't guess": anything that does not map cleanly
 * becomes `unclear` and gets an honest question back, rather than being forced
 * into the nearest category.
 */

export interface Classification {
  intent: Intent;
  confidence: number;
  /** Which patterns fired, best first. Logged for unclear/misread messages. */
  matched: string[];
  scores: Record<string, number>;
}

/** Enough confidence to act without asking. */
export const ACT_THRESHOLD = 0.6;

/**
 * Below this, nothing is actionable and the message is unclear. Between this and
 * ACT_THRESHOLD an undo must be confirmed first — a misread message must never
 * silently delete a real transaction (Section 3).
 */
export const CONFIRM_THRESHOLD = 0.35;

/**
 * When summary and undo score this close together, the message is genuinely
 * ambiguous. Picking the higher one would be exactly the guess the spec forbids.
 */
const AMBIGUITY_MARGIN = 0.1;

/**
 * Scores are sums of decimal weights, so an intended gap of exactly the margin
 * lands a hair under it in binary floating point (0.6 - 0.5 = 0.0999...). Without
 * this, two clearly-separated scores read as a tie.
 */
const EPSILON = 1e-9;

function closerThanMargin(a: number, b: number): boolean {
  return Math.abs(a - b) < AMBIGUITY_MARGIN - EPSILON;
}

interface Score {
  score: number;
  matched: string[];
}

function scoreAgainst(tokens: string[], patterns: Pattern[]): Score {
  let best = 0;
  let confidentMatches = 0;
  const matched: { phrase: string; weight: number }[] = [];

  for (const pattern of patterns) {
    if (!containsInOrder(tokens, pattern.words)) continue;

    matched.push({ phrase: pattern.words.join(" "), weight: pattern.weight });
    best = Math.max(best, pattern.weight);
    if (pattern.weight >= WEIGHT.KEYWORD) confidentMatches += 1;
  }

  // Several independent signals are worth more than one, but never enough to
  // reach the certainty of a full phrasing on their own.
  const corroboration = confidentMatches >= 2 ? 0.1 : 0;
  const score = Math.min(best + corroboration, WEIGHT.DECISIVE);

  matched.sort((a, b) => b.weight - a.weight);
  return { score, matched: matched.map((entry) => entry.phrase) };
}

export function classifyIntent(text: string): Classification {
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return { intent: "unclear", confidence: 0, matched: [], scores: {} };
  }

  const summary = scoreAgainst(tokens, PATTERNS_BY_INTENT.request_summary);
  const undo = scoreAgainst(tokens, PATTERNS_BY_INTENT.request_undo);
  const smallTalk = scoreAgainst(tokens, PATTERNS_BY_INTENT.small_talk);

  const scores = {
    request_summary: round(summary.score),
    request_undo: round(undo.score),
    small_talk: round(smallTalk.score),
  };

  const unclear = (): Classification => ({
    intent: "unclear",
    confidence: 0,
    matched: [...summary.matched, ...undo.matched].slice(0, 4),
    scores,
  });

  // The two intents that touch the user's data. If a message reads as both,
  // it maps cleanly to neither — ask instead of picking a side.
  const bothActionable = summary.score >= CONFIRM_THRESHOLD && undo.score >= CONFIRM_THRESHOLD;
  if (bothActionable && closerThanMargin(summary.score, undo.score)) {
    return unclear();
  }

  const ranked = (
    [
      { intent: "request_summary", result: summary },
      { intent: "request_undo", result: undo },
      { intent: "small_talk", result: smallTalk },
    ] satisfies { intent: Intent; result: Score }[]
  ).sort((a, b) => b.result.score - a.result.score);

  const winner = ranked[0];
  if (winner.result.score < CONFIRM_THRESHOLD) return unclear();

  return {
    intent: winner.intent,
    confidence: round(winner.result.score),
    matched: winner.result.matched.slice(0, 4),
    scores,
  };
}

/** Yes/no reading of a reply to a confirm-before-undo question. */
export function classifyConfirmation(text: string): "yes" | "no" | "unclear" {
  const tokens = tokenize(text);
  if (tokens.length === 0) return "unclear";

  const yes = scoreAgainst(tokens, AFFIRMATIVE_PATTERNS).score;
  const no = scoreAgainst(tokens, NEGATIVE_PATTERNS).score;

  // Ties and near-ties resolve to unclear, which never deletes anything.
  if (closerThanMargin(yes, no)) return "unclear";
  if (no > yes && no >= WEIGHT.STRONG) return "no";
  if (yes > no && yes >= WEIGHT.STRONG) return "yes";
  return "unclear";
}

export type SmallTalkFlavor = "greeting" | "gratitude" | "acknowledgement" | "capability";

/**
 * Small talk is one intent but several different things to say back. "Hey 👋"
 * is a poor answer to "thank you", and a worse one to "what can you do".
 */
export function smallTalkFlavor(text: string): SmallTalkFlavor {
  const tokens = tokenize(text);
  if (tokens.length === 0) return "greeting";

  const capability = scoreAgainst(tokens, CAPABILITY_PATTERNS).score;
  const gratitude = scoreAgainst(tokens, GRATITUDE_PATTERNS).score;
  const acknowledgement = scoreAgainst(tokens, ACKNOWLEDGEMENT_PATTERNS).score;

  // Most specific first: a capability question outranks a bare "ok" inside it.
  if (capability >= WEIGHT.KEYWORD) return "capability";
  if (gratitude >= WEIGHT.STRONG) return "gratitude";
  if (acknowledgement >= WEIGHT.STRONG) return "acknowledgement";
  return "greeting";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
