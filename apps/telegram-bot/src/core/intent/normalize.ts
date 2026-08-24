/**
 * Text normalization for intent matching (Section 3, approach 1).
 *
 * Lowercase, strip punctuation, collapse whitespace. Deliberately lossy: the
 * point is to make "How much have I spent?!" and "how much have i spent" the
 * same string before any matching happens.
 */

/** Contractions and shorthand a test group actually types, expanded before matching. */
const EXPANSIONS: Record<string, string> = {
  "i've": "i have",
  "ive": "i have",
  "i'm": "i am",
  "im": "i am",
  "don't": "do not",
  "dont": "do not",
  "didn't": "did not",
  "didnt": "did not",
  "wasn't": "was not",
  "wasnt": "was not",
  "isn't": "is not",
  "isnt": "is not",
  "shouldn't": "should not",
  "shouldnt": "should not",
  "couldn't": "could not",
  "couldnt": "could not",
  "won't": "will not",
  "wont": "will not",
  "can't": "can not",
  "cant": "can not",
  "doesn't": "does not",
  "doesnt": "does not",
  "haven't": "have not",
  "havent": "have not",
  "aren't": "are not",
  "arent": "are not",
  "that's": "that is",
  "thats": "that is",
  "what's": "what is",
  "whats": "what is",
  "how's": "how is",
  "hows": "how is",
  "pls": "please",
  "plz": "please",
  "u": "you",
  "ur": "your",
  "wat": "what",
  "wan": "want",
  "abt": "about",
  "hw": "how",
  "mch": "much",
  // Shorthand that survives no amount of fuzzy matching, because it shares
  // too few letters with the word it stands for.
  "thanx": "thanks",
  "thnx": "thanks",
  "tnx": "thanks",
  "tks": "thanks",
  "ty": "thanks",
  "k": "ok",
  "kk": "ok",
  "gud": "good",
  "gd": "good",
  "abeg": "please",
  "wetin": "what",
  // "dey" is left alone on purpose. Expanding it to "are" made "you dey" into
  // "you are", which is too generic to match on safely — it appears inside
  // plenty of non-greetings. It is matched directly as a pidgin pattern instead.
};

/**
 * Emoji people send as a whole message. A bare 👍 is an acknowledgement and
 * deserves better than "I didn't catch that". Anything not listed is stripped,
 * which correctly leaves an unreadable message unclear.
 */
const EMOJI: Record<string, string> = {
  "👍": " ok ",
  "👌": " ok ",
  "✅": " ok ",
  "💯": " ok ",
  "🔥": " ok ",
  "😂": " ok ",
  "😅": " ok ",
  "🙂": " ok ",
  "😊": " ok ",
  "😃": " ok ",
  "🙏": " thank you ",
  "🙌": " thank you ",
  "❤": " thank you ",
  "👋": " hello ",
};

/**
 * Replaces known emoji with the word they stand for. Exported because a bare
 * "👍" is a real message with no letters in it — both the junk filter and the
 * model need it turned into "ok" before they can see anything there.
 */
export function expandEmoji(text: string): string {
  let value = text;
  for (const [emoji, word] of Object.entries(EMOJI)) {
    value = value.split(emoji).join(word);
  }
  return value.replace(/\s+/g, " ").trim();
}

export function normalize(text: string): string {
  let value = expandEmoji(text.toLowerCase().trim());

  // Expand before stripping punctuation so apostrophe forms are caught too.
  for (const [from, to] of Object.entries(EXPANSIONS)) {
    value = value.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }

  return value
    // Keep letters and digits from any script; everything else becomes a gap.
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    // "okkkk" -> "ok", "heyyyy" -> "hey". Letters only: collapsing digit runs
    // would turn 5,000,000 into 50.
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized === "" ? [] : normalized.split(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A slash command, if the message is one. Section 3 keeps /summary and /undo as
 * undocumented conveniences — they are not the interface, but they should work.
 * Handled here rather than in the adapter: a WhatsApp user could type "/undo"
 * just as easily, so this is not a Telegram concern.
 */
export function parseCommand(text: string): string | null {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}
