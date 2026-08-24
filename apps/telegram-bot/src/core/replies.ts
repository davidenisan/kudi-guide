/**
 * Response phrasing (Section 3).
 *
 * Several variants per response type, so the bot doesn't read as copy-pasted
 * across messages. The rule that governs every line here: vary how it says it,
 * never what it says. Amounts, merchants and categories are always exact.
 *
 * The line none of these cross: no opinions, no advice, no warnings, no
 * predictions, no "you should". Warmth lives in phrasing, not in commentary
 * about the user's money.
 */

/** Remembers the last variant used per user, so the same one isn't picked twice running. */
const lastUsed = new Map<string, number>();
const MAX_TRACKED = 500;

export function pick(key: string, variants: readonly string[], userId?: number): string {
  if (variants.length === 1) return variants[0];

  const slot = `${userId ?? "anon"}:${key}`;
  const previous = lastUsed.get(slot);

  let index = Math.floor(Math.random() * variants.length);
  if (index === previous) index = (index + 1) % variants.length;

  if (lastUsed.size > MAX_TRACKED) lastUsed.clear();
  lastUsed.set(slot, index);
  return variants[index];
}

/** First contact. A warm one-liner, not a command menu (Section 3). */
export const START = [
  "Hey 👋 Send me a receipt screenshot and I'll keep track of it for you.",
  "Hi! Send over any bank or fintech receipt and I'll log it for you. You can ask me how much you've spent anytime.",
  "Hey — send me a screenshot of a payment and I'll note it down. Ask me for your spending whenever you want it.",
];

/** Greetings. Brief, then let the user lead — no funnelling back to "send me a receipt". */
export const SMALL_TALK = [
  "Hey 👋",
  "Hi — I'm here.",
  "Hey, all good.",
  "I'm around 👋",
  "Hey! What's up?",
];

export const GRATITUDE = ["Anytime 👍", "No wahala.", "Sure thing.", "Anytime.", "👍"];

/** "ok", "got it", a bare 👍. Match their brevity — don't restart the conversation. */
export const ACKNOWLEDGEMENT = ["👍", "Got it.", "Sure.", "👌", "Alright."];

/**
 * "What can you do?" — a fair question that deserves a real answer. Describing
 * what the bot does is not advice about the user's money, so this stays on the
 * right side of Section 3's line.
 */
export const CAPABILITY = [
  "Send me a screenshot of any bank or fintech receipt and I'll pull out the amount, merchant and date, then file it under a category. Ask me how much you've spent whenever you like, or tell me if something's wrong and I'll take it back out.",
  "Mostly I read receipts. Send me a payment screenshot and I'll log it and categorise it. You can ask me for your spending anytime, or tell me to remove something I got wrong.",
];

/**
 * Understood, but not something this bot does.
 *
 * Different from UNCLEAR on purpose. Answering "did you want your spending
 * summary?" to a question about the weather pretends to be confused when the
 * bot understood perfectly — it just doesn't do weather. Saying so plainly, and
 * saying what it *does* do, is more honest and more useful.
 *
 * Still no advice and no opinions: this describes the bot's own scope, which is
 * on the right side of Section 3's line.
 */
export const OUT_OF_SCOPE = [
  "That one's outside what I do — I just keep track of receipts. Send me a payment screenshot and I'll log it, or ask me what you've spent.",
  "Can't help with that one, sorry. What I do is read receipts, keep your totals, and take entries back out if they're wrong.",
  "Not something I can do, I'm afraid. Receipts and totals are my whole job — send me a screenshot and I'll take it from there.",
];

export const OUT_OF_SCOPE_PIDGIN = [
  "That one no be my work o. Na receipt I dey read — send screenshot make I log am, or ask me how much you don spend.",
  "I no fit do that one. Wetin I sabi na receipt, your total, and to comot entry wey no correct.",
];

/** Section 3's honest fallback — a real question, not an "invalid command" error. */
export const UNCLEAR = [
  "Not sure I caught that — did you want your spending summary, or is something wrong with a transaction I logged?",
  "Hmm, I didn't quite follow. Were you after your spending, or is one of your entries wrong?",
  "Sorry, not sure what you meant there. Do you want your totals, or should I take something back out?",
];

/** Low-confidence undo: confirm before touching anything (Section 3). */
export const UNDO_CONFIRM_GENERIC = [
  "Just to check — do you want me to take out the last thing I logged?",
  "Want me to remove the most recent entry? Just say yes.",
  "Should I take the last one back out?",
];

export const UNDO_ABORTED = [
  "No problem — leaving it as it is.",
  "Alright, nothing removed.",
  "Sure, I've left it there.",
];

/** Media that isn't an image or PDF (Section 8). Friendly, never a crash. */
export const UNSUPPORTED_MEDIA = [
  "That's not something I can read — send a screenshot of a bank or fintech payment confirmation, or just ask me how much you've spent.",
  "I can only read images and PDFs. A screenshot of the payment confirmation works best.",
];

export const MEDIA_TOO_LARGE = [
  "That file's too big for me to pull in — a screenshot of the receipt would work better.",
  "That one's over the size I can fetch. Try a screenshot instead?",
];

export const MEDIA_FAILED = [
  "I couldn't download that one — mind sending it again?",
  "That didn't come through properly. Could you resend it?",
];

export const GENERIC_ERROR = [
  "Something went wrong on my end with that one — mind sending it again?",
  "That didn't work out on my side. Try once more?",
];

// ---------------------------------------------------------------------------
// Register mirroring
// ---------------------------------------------------------------------------

/**
 * Pidgin variants, used when the model reads the incoming message as Pidgin.
 *
 * This is the "context-aware" part that does not require generating text:
 * the bot answers in the register it was addressed in. Same meaning, same
 * accuracy guarantees — only the phrasing moves.
 */
export const SMALL_TALK_PIDGIN = ["I dey here 👋", "How far 👋", "I dey o.", "Everything dey fine 👋"];

export const GRATITUDE_PIDGIN = ["No wahala 👍", "Anytime o.", "Na nothing.", "You welcome 👍"];

export const ACKNOWLEDGEMENT_PIDGIN = ["👍", "Okay o.", "I don hear.", "Correct 👍"];

export const UNCLEAR_PIDGIN = [
  "I no too catch that one — you wan see your spending, or something wrong with wetin I log?",
  "Abeg I no understand well. You want your total, or make I comot something?",
];

export const UNDO_CONFIRM_PIDGIN = [
  "Make I comot the last one wey I log?",
  "You want make I remove the last entry? Just talk yes.",
];

export const UNDO_ABORTED_PIDGIN = ["No wahala — I go leave am.", "Okay, I no touch am."];

type Register = "pidgin" | "standard";

/** Picks the variant set matching the register the user wrote in. */
export function byRegister(
  register: Register,
  standard: readonly string[],
  pidgin: readonly string[],
): readonly string[] {
  return register === "pidgin" ? pidgin : standard;
}
