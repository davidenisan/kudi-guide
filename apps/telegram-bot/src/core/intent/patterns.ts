import { normalize } from "./normalize.js";

/**
 * The pattern surface for intent classification (Section 3).
 *
 * Deliberately broad, per the spec: not three literal strings, but generous
 * phrase sets that a small test group's real phrasings will land inside. Every
 * pattern here is matched in order but gap-tolerantly and with typo tolerance,
 * so each line covers a family of phrasings rather than one exact sentence.
 *
 * Nigerian English and pidgin are included on purpose — the test group is
 * Nigerian, and "abeg comot that one" is a perfectly ordinary way to ask for an
 * undo. Trim these if the real logs say otherwise.
 */

export type Intent = "request_summary" | "request_undo" | "small_talk" | "unclear";

/** How much a match is worth. Longer, less ambiguous phrasings score higher. */
export const WEIGHT = {
  /** Unmistakable — a full phrasing of the request. */
  DECISIVE: 0.95,
  /** Clear in context, a few words. */
  STRONG: 0.8,
  /** A single telling word. Enough to act on alone for a read-only intent. */
  KEYWORD: 0.6,
  /**
   * A word that points at an intent but has ordinary other uses — "wrong",
   * "mistake". Lands in the confirm band on its own: enough to ask about,
   * never enough to act on.
   */
  AMBIGUOUS: 0.5,
  /** Suggestive only. Never enough on its own. */
  WEAK: 0.4,
} as const;

export interface Pattern {
  words: string[];
  weight: number;
}

function group(weight: number, phrases: string[]): Pattern[] {
  return phrases.map((phrase) => ({ words: normalize(phrase).split(" "), weight }));
}

export const SUMMARY_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, [
    "how much have i spent",
    "how much did i spend",
    "how much am i spending",
    "how much have i used",
    "how much did i use",
    "what am i spending on",
    "what have i spent on",
    "where is my money going",
    "where did my money go",
    "show me my spending",
    "show me my expenses",
    "give me my summary",
    "what is my spending",
    "how is my spending",
    "how much i don spend",
    "wetin i don spend",
    "how much i don use",
    "how much do i spend this month",
    "break down my spending",
  ]),
  ...group(WEIGHT.STRONG, [
    "how much spent",
    "how much spend",
    "how much money",
    "spending summary",
    "spending breakdown",
    "spending report",
    "my spending",
    "my expenses",
    "my summary",
    "total spent",
    "total spending",
    "this month",
    "so far this month",
    "what i spent",
    "what i have spent",
    "spent on food",
    "spent so far",
  ]),
  ...group(WEIGHT.KEYWORD, ["summary", "breakdown", "spending", "spent", "expenses", "totals"]),
  ...group(WEIGHT.WEAK, ["total", "month", "report", "much"]),
  // Asking about one category is still a summary request.
  ...group(WEIGHT.DECISIVE, [
    "check my spending",
    "what is my total",
    "show me my total",
    "how much on food",
    "how much on transport",
    "how much did i spend on",
    "how much have i spent on",
    "what is my balance so far",
    "how much left this month",
  ]),
  ...group(WEIGHT.STRONG, [
    "my money",
    "show me",
    "how much on",
    "food spending",
    "transport spending",
    "money spent",
    "money go",
  ]),
];

export const UNDO_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, [
    "undo the last transaction",
    "undo the last one",
    "delete the last one",
    "delete the last transaction",
    "remove the last one",
    "remove the last transaction",
    "take that out",
    "take it out",
    "that was wrong",
    "that one was wrong",
    "that is wrong",
    "that was not right",
    "that is not right",
    "that is not correct",
    "that was a mistake",
    "cancel that one",
    "remove that one",
    "delete that one",
    "forget that one",
    "e no correct",
    "no be correct",
    "comot that one",
    "abeg comot am",
    "abeg remove am",
    "i sent the wrong one",
    "that should not be there",
  ]),
  ...group(WEIGHT.STRONG, [
    "remove that",
    "delete that",
    "undo that",
    "cancel that",
    "forget that",
    "remove it",
    "delete it",
    "undo it",
    "cancel it",
    "remove am",
    "comot am",
    "not right",
    "was wrong",
    "is wrong",
    "wrong one",
    "last one",
    "last entry",
    "last transaction",
    "wrong entry",
    "wrong amount",
  ]),
  // Words nobody types by accident — acting on these alone is safe.
  ...group(WEIGHT.STRONG, ["undo", "revert"]),
  ...group(WEIGHT.KEYWORD, ["delete", "remove", "cancel"]),
  // "That's the wrong amount" is a complaint, not necessarily an undo request.
  // These ask before they act.
  ...group(WEIGHT.AMBIGUOUS, ["wrong", "mistake", "incorrect", "clear"]),
  ...group(WEIGHT.WEAK, ["oops", "scratch"]),
  // Other ways of saying "take it back out".
  ...group(WEIGHT.DECISIVE, [
    "i sent the wrong receipt",
    "i sent wrong receipt",
    "sent the wrong one",
    "that receipt is wrong",
    "take that off",
    "take it off",
    "get rid of that",
    "get rid of it",
  ]),
  ...group(WEIGHT.STRONG, [
    "clear that",
    "clear it",
    "erase that",
    "erase it",
    "scrap that",
    "wipe that",
    "wrong receipt",
    "wrong one",
    "last receipt",
    "undo last",
  ]),
  ...group(WEIGHT.KEYWORD, ["erase", "scrap"]),
];

export const SMALL_TALK_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, [
    "good morning",
    "good afternoon",
    "good evening",
    "good day",
    "how are you",
    "how are you doing",
    "are you there",
    "you there",
    "how far",
    "how body",
    "thank you",
    "well done",
    "nice one",
    "what is up",
    "long time",
  ]),
  ...group(WEIGHT.STRONG, ["hello", "hey", "thanks", "morning", "evening", "afternoon", "howdy"]),
  ...group(WEIGHT.KEYWORD, ["hi", "yo", "sup", "wassup", "greetings", "ok", "okay"]),
  ...group(WEIGHT.WEAK, ["cool", "nice", "great", "alright", "please", "noted", "fine"]),
  // Acknowledgements are small talk too — they need to classify here before
  // smallTalkFlavor() can tell them apart from a greeting.
  ...group(WEIGHT.DECISIVE, ["got it", "no problem", "no wahala", "all good", "sounds good", "understood"]),
  // Pidgin and other ways of checking the bot is awake.
  ...group(WEIGHT.DECISIVE, [
    "you are there",
    "you still there",
    "are you working",
    "are you awake",
    "you around",
    "how body",
    // Pidgin: "you dey?" is "are you there?"
    "you dey there",
    "you dey",
    "dey there",
    "how you dey",
    "you sef",
  ]),
  // Capability questions. Not one of Section 3's four intents, but replying
  // "I didn't catch that" to "what can you do" is a bad answer to a fair
  // question. Classified as small talk, answered with a plain description of
  // what the bot does — which is not advice about anyone's money.
  ...group(WEIGHT.DECISIVE, [
    "what can you do",
    "what do you do",
    "how does this work",
    "how do you work",
    "how does it work",
    "who are you",
    "what are you",
    "how do i use this",
    "what should i send",
    "what do you need",
  ]),
  ...group(WEIGHT.KEYWORD, ["help"]),
];

/** Small talk that is a capability question rather than a greeting. */
export const CAPABILITY_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, [
    "what can you do",
    "what do you do",
    "how does this work",
    "how do you work",
    "how does it work",
    "who are you",
    "what are you",
    "how do i use this",
    "what should i send",
    "what do you need",
  ]),
  ...group(WEIGHT.KEYWORD, ["help"]),
];

/**
 * Acknowledgements — "ok", "got it", "👍". Answering these with a greeting is
 * the kind of thing that makes a bot feel like a bot.
 */
export const ACKNOWLEDGEMENT_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, ["got it", "no problem", "no wahala", "all good", "sounds good"]),
  ...group(WEIGHT.STRONG, ["ok", "okay", "alright", "cool", "noted", "understood", "fine", "great"]),
];

/**
 * Gratitude is small talk, but "Hey 👋" is a strange answer to "thank you".
 * Separating them is cheap and makes the difference between sounding like a
 * person and sounding like a greeting matcher.
 */
export const GRATITUDE_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, ["thank you", "thanks a lot", "thanks so much", "much appreciated", "well done"]),
  ...group(WEIGHT.STRONG, ["thanks", "thanx", "appreciate", "nice one", "good job"]),
];

export const PATTERNS_BY_INTENT: Record<Exclude<Intent, "unclear">, Pattern[]> = {
  request_summary: SUMMARY_PATTERNS,
  request_undo: UNDO_PATTERNS,
  small_talk: SMALL_TALK_PATTERNS,
};

/**
 * Replies to a confirm-before-undo question. Kept narrow on purpose: anything
 * not clearly affirmative must not delete a real transaction.
 */
export const AFFIRMATIVE_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, ["yes please", "yes remove it", "yes delete it", "go ahead", "do it", "na so", "that one"]),
  ...group(WEIGHT.STRONG, ["yes", "yeah", "yep", "yup", "correct", "confirm", "sure", "please do", "abeg yes"]),
];

export const NEGATIVE_PATTERNS: Pattern[] = [
  ...group(WEIGHT.DECISIVE, ["no leave it", "never mind", "nevermind", "leave it", "do not remove", "do not delete"]),
  ...group(WEIGHT.STRONG, ["no", "nope", "nah", "cancel", "stop", "wrong one"]),
];
