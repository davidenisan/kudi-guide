/**
 * Register detection and junk detection.
 *
 * Neither of these is intent classification, which is why neither asks the
 * model. "Does this message contain Pidgin words" and "does this message contain
 * any language at all" are surface properties of the text — countable, not
 * interpreted. The 1.5B model turned out to be unreliable at both (it labelled
 * "hi" and "good morning" as Pidgin, and gave "gjkl" an intent), while a short
 * word list gets them right every time, instantly and for free.
 *
 * The model keeps the job it is actually good at: working out what the person
 * meant. Removing these two fields from its output also makes every message
 * faster, because there is less JSON to generate.
 */

/**
 * High-signal Pidgin and Nigerian-slang markers. Matched against the raw
 * message, before normalization — normalize() rewrites "abeg" to "please" and
 * "dey" to "are", which would erase the evidence.
 *
 * Deliberately conservative: a missed Pidgin message just gets a standard-
 * English reply, which is fine. A false positive answers "I dey here" to
 * someone who wrote "hi", which is not.
 */
const PIDGIN_MARKERS = [
  "dey",
  "abeg",
  "wetin",
  "comot",
  "sabi",
  "wahala",
  "biko",
  "oga",
  "abi",
  "sha",
  "wey",
  "una",
  "jare",
  "naw",
  "chop",
  "waka",
  "shey",
  "how far",
  "no be",
  "e no",
  "na so",
  "my guy",
  "i don",
  "you don",
  "don finish",
];

export function detectRegister(text: string): "pidgin" | "standard" {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ")} `;
  return PIDGIN_MARKERS.some((marker) => haystack.includes(` ${marker} `)) ? "pidgin" : "standard";
}

/**
 * Vowel-less tokens that are nonetheless real messages. Everything else without
 * a vowel is keyboard mash.
 */
const VOWEL_LESS_WORDS = new Set(["hmm", "hm", "mm", "mhm", "hmmm", "shh", "psst", "brb", "lol", "smh"]);

/**
 * Every one- and two-letter token that is a real word here, English or Pidgin.
 *
 * Short tokens need an explicit list rather than a vowel test: "gi" has a vowel
 * and is not a word, and a message of "gi]\" was being read as a spending
 * summary because of it. The set of real 1-2 letter words is small enough to
 * write down, so write it down.
 */
const SHORT_WORDS = new Set([
  // English
  "a", "i", "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is", "it",
  "me", "my", "no", "of", "oh", "ok", "on", "or", "so", "to", "up", "us", "we", "ya", "yo",
  // Pidgin and Nigerian usage
  "na", "e", "o", "un", "abi",
]);

/**
 * Five or more consonants in a row. Real words essentially never do this;
 * keyboard mash does it constantly ("asdfgh" -> "sdfgh").
 */
const CONSONANT_RUN = /[^aeiou\d]{4,}/;

/**
 * Keyboard rows and the handful of strings people actually mash. These are
 * structurally word-like — "qwerty" has vowels and no consonant run — so no
 * general rule catches them, but the list of ones anyone types is short.
 */
const KEYBOARD_MASH = new Set([
  "qwerty", "qwertyuiop", "qwe", "qaz", "wsx", "edc",
  "asdf", "asdfg", "asdfgh", "asdfghjkl", "asd",
  "zxc", "zxcv", "zxcvb", "zxcvbn",
  "abcd", "abcde", "abcdef", "1234", "12345", "123456",
]);

/** Letters and digits jumbled together — "vdfge0300", "skdos0", "xkcd992". */
const MIXED_ALPHANUMERIC = /(?=.*[a-z])(?=.*\d)/;

function isWordLike(token: string): boolean {
  if (KEYBOARD_MASH.has(token)) return false;
  // Real words don't mix letters and digits. A genuine "9mobile" or "50k" only
  // ever appears alongside real words, and one word-like token is enough to
  // keep the whole message out of the junk bin.
  if (MIXED_ALPHANUMERIC.test(token)) return false;
  if (VOWEL_LESS_WORDS.has(token)) return true;
  // Short tokens must be actual words, not merely vowel-bearing.
  if (token.length <= 2) return SHORT_WORDS.has(token);
  if (!/[aeiou]/.test(token)) return false;
  // All vowels and nothing else ("aaaaa", "eeee") is not a word either.
  if (!/[^aeiou]/.test(token)) return false;
  return !CONSONANT_RUN.test(token);
}

/**
 * True when a message contains nothing word-like — "gj]\", "....", "??", "5000".
 *
 * Checked before the model is asked anything. A model forced to choose an intent
 * for keyboard mash will choose one, and it picked "spending summary" for "....".
 * There is no meaning in these messages to interpret, so interpreting them is
 * the wrong move: they go straight to the honest "I didn't follow that" reply.
 *
 * Note this deliberately treats a bare number as junk. "5000" on its own is not
 * a request for anything — Phase 0 logs receipts, not typed-in amounts.
 */
export function isJunkText(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return true;

  return !tokens.some(isWordLike);
}
