import type { Turn } from "../conversation.js";
import { logger } from "../../logger.js";
import { generateChat, isNluEnabled } from "./model.js";

/**
 * Letting the model do the talking — for the half of the conversation where
 * there is nothing to get factually wrong.
 *
 * The dividing line is data. A reply carrying an amount, a merchant, a category
 * or a total is built from templates and filled in from the database, because
 * those must be exactly right and a language model will cheerfully produce
 * ₦150,000 where the truth was ₦15,000. Everything else — greetings, banter,
 * "you're not fun bro", explaining what the bot can't do — has no fact to get
 * wrong, and templates there are what made the bot feel like a phone tree.
 *
 * So the model writes those, under guardrails enforced in code rather than
 * trusted to the prompt: see isSafeReply. If generation fails, times out, or
 * produces something that trips a guardrail, the caller falls back to the
 * fixed phrasings, and the bot is merely less lively rather than wrong.
 */

const SYSTEM_PROMPT = `You are Kudi Guide, an assistant on Telegram that keeps track of what Nigerians spend, by reading receipts they send you.

You are having an ordinary conversation. Reply to what the person actually said — the specific thing, not the category of thing. If they tease you, take it. If they ask about you, answer. If they say something you cannot help with, say so plainly and say what you do instead. Sound like a real person texting back: warm, brief, a bit dry. Never corporate, never bubbly, never a form letter.

What you actually do:
- Read receipt screenshots they send you, and pull out the amount, merchant and date.
- File each one under a spending category.
- Tell them what they have spent when they ask.
- Take an entry back out when you got one wrong.

What you cannot do: connect to a bank, link a card, import or sync transactions, set budgets, give loans, open a dashboard, or record spending someone types out in words instead of sending the receipt.

Hard rules you must never break:
- Never mention any amount, total, figure or number about their money. You cannot see their data while chatting, so any number you write would be invented.
- Only mention the limitation they actually ran into. Do not bring up banks, budgets or loans if they did not ask about them.
- Never claim you have logged, removed, saved or found anything. Another part of the system does that and tells them itself. You are only talking.
- Never give financial advice, opinions, warnings, predictions or suggestions about their spending — not even when asked directly, and not even gently. If they ask whether they should buy, stop buying, save or cut back, say plainly that you don't weigh in on that, and say what you do instead.
- Never offer to discuss or help with something you cannot do. "Sure, let's talk about that" is a promise you can't keep — say what you can't do, once, and move on.
- One or two short sentences. No lists, no bullet points. At most one emoji, usually none.
- Answer in the language they used. If they write Pidgin, reply in Pidgin. If they write standard English, reply in standard English with ordinary spelling — never phonetic, never mock-accent.
- Speak about yourself in the first person: "I can't connect to your bank", never "you can't connect to your bank".
- Do not end every message by asking for a receipt. Let the conversation breathe.
- Do not repeat a reply you have already given in this conversation. If you already said something, say the next thing or say it differently.

Reply with the message text only — no quotes, no labels, no explanation.`;

export type Situation =
  | "greeting"
  | "gratitude"
  | "acknowledgement"
  | "capability"
  | "chitchat"
  | "out_of_scope"
  | "not_understood";

export interface ReplyContext {
  /** What they said. */
  text: string;
  /** Their first name, when the transport gave us one. */
  name?: string | null;
  /** What the classifier made of the message, to steer the reply. */
  situation: Situation;
  /** The last few turns, so a reply can follow on rather than restart. */
  history?: readonly Turn[];
  /** Which way to answer. Detected from their words, not guessed by the model. */
  register?: "pidgin" | "standard";
}

const GUIDANCE: Record<Situation, string> = {
  greeting: "They are saying hello or checking you are there. Greet them back briefly and let them lead.",
  gratitude: "They are thanking you. Accept it in a few words.",
  acknowledgement:
    "They are acknowledging something with a short 'ok' or similar. Match their brevity — a couple of words is plenty, and there is nothing here to explain.",
  capability: "They are asking what you can do. Tell them, in one or two sentences, plainly.",
  chitchat:
    "They are making conversation with you — teasing you, complaining about your replies, asking about you, or just chatting. Answer the actual remark like a person would. If they say you are boring or robotic, take it on the chin rather than denying it or ignoring it. Do not answer a remark with a greeting.",
  out_of_scope:
    "They are asking for something you cannot do, or telling you about spending in words rather than sending a receipt. Say so directly without apologising twice, and mention what you can do instead. If they typed out an expense, tell them to send the receipt screenshot and you will log it. If they are asking you to judge their spending — should they buy this, should they cut back — say you don't weigh in on that, without softening it into an offer to discuss it.",
  not_understood:
    "You could not tell what they meant. Ask what they were after — mention that you can show what they've spent, or take an entry back out. Do not pretend to understand.",
};

/**
 * Rejects anything a language model should not be putting in front of a user
 * here. Enforced after generation, so it holds regardless of what the model
 * decides to do with its instructions.
 */
function isSafeReply(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length === 0 || trimmed.length > 320) return false;

  // The model has no access to real figures, so every digit it writes is
  // invented. Blanket ban: no conversational reply here needs one.
  if (/\d/.test(trimmed)) return false;

  // Advice is the one thing this product deliberately does not do.
  if (/\b(you should|you ought|i suggest|i recommend|i'd advise|cut down|spend less|save more|try to spend)\b/i.test(trimmed)) {
    return false;
  }

  // Claiming an action it did not take. The conversational path never touches
  // data, so any "I've logged that" is a fabrication — and a costly one, since
  // someone told their receipt was saved will stop checking whether it was.
  if (
    /\b(i(?:'ve| have)?\s+(?:just\s+)?(?:logged|recorded|saved|added|removed|deleted|taken\s+(?:it\s+)?out|updated|found)|i\s+(?:log|record|save|add|remove|delete)d)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  // Inventing an ability. Only affirmative claims — "I can't connect to your
  // bank" is the correct answer to that question and must survive.
  if (
    /\b(i(?:'ll| will| can| could| have|'ve)?\s+(?:now\s+)?(?:connect|link|sync|import)|let me (?:connect|link|sync|import))\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  // A model that starts explaining itself has stopped answering.
  if (/^(sure[,!.]?\s*here|as an ai|i'm an ai|reply:)/i.test(trimmed)) return false;

  // Prompt scaffolding coming back out. A small model handed a transcript will
  // sometimes continue it instead of answering it, and "You do not know their
  // name." went out as a reply during testing.
  if (
    /\b(you do not know their name|you are talking to|the conversation so far|they have just said|reply to that message|hard rules)\b/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Told only "reply in Pidgin", a 4-bit model does not write Pidgin — it writes
 * English with the vowels knocked out ("Ya no talk like peepo"). Naming the real
 * thing, with examples of how it is actually written, is what stops it. The
 * examples are phrases from replies.ts, so generated Pidgin and the handwritten
 * Pidgin fallbacks sound like the same bot.
 */
const PIDGIN_INSTRUCTION = `They are writing in Nigerian Pidgin, so reply in Nigerian Pidgin — the way it is genuinely written: "I dey here o", "No wahala", "Na receipt I dey read", "I no fit do that one", "Abeg send the screenshot". Never spell English words phonetically. "peepo", "ya", "wot", "dem tin" are not Pidgin, they are English misspelt, and they read as mockery.`;

const STANDARD_INSTRUCTION =
  "They are writing in standard English. Reply in standard English, spelled normally.";

/**
 * Mock-accent spelling. Caricature in either register, so checked in both:
 * these are English words with letters knocked out, not Pidgin words.
 */
const MOCK_DIALECT = /\b(peepo|pipo|wot|yuh|ya|dem tin|tink|nuttin|sumtin|u've|u're|u'll)\b/i;

/**
 * Additionally rejected in standard English. These ARE ordinary in Pidgin, so
 * the register — detected from the person's own words, never guessed — decides
 * whether they are a defect.
 */
const MOCK_DIALECT_IN_ENGLISH = /\b(dat|dis|dere|dem)\b/i;

const normalise = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Removes the person's own words from the front of the reply.
 *
 * Parroting is the characteristic failure of a small model given a short
 * message: "you arent fun to chat with frfr" came back verbatim on the 1.5B, and
 * the 3B opens with "That's it?" before answering. The tail is usually a
 * perfectly good reply, so the echo is cut rather than the whole thing thrown
 * away — which turns the worst-looking reply the bot can send into a decent one.
 *
 * Returns null when nothing survives the cut. That sends the caller to a
 * template, which is the right outcome: a message the model could only repeat
 * back is one where a fixed phrase loses nothing.
 */
function withoutEcho(reply: string, theirs: string): string | null {
  const original = normalise(theirs);
  // Below this an overlap is coincidence — "ok" appearing in a reply to "ok".
  if (original.length < 4) return reply;

  const sentences = reply.match(/[^.!?]+[.!?]*\s*/g) ?? [reply];
  let index = 0;

  while (index < sentences.length) {
    const sentence = normalise(sentences[index]);
    // Their words, alone or behind a short filler — "Naah, how far?".
    const isEcho = sentence === original || (sentence.endsWith(original) && sentence.length - original.length <= 10);
    if (!isEcho) break;
    index += 1;
  }

  if (index === 0) return reply;

  const remainder = sentences.slice(index).join("").trim();
  return remainder.length >= 12 ? remainder : null;
}

/** Strips quoting and labels a small model sometimes wraps around its answer. */
function clean(text: string): string {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(reply|response|message)\s*:\s*/i, "")
    .trim();
}

/**
 * Rejects a reply that repeats what the bot just said.
 *
 * A small model handed a short transcript tends to echo its own last line, and
 * two identical answers in a row is exactly the phone-tree feeling this path
 * exists to remove. Falling back to a template here is a real improvement: the
 * templates vary deliberately.
 */
function repeatsRecentReply(reply: string, history: readonly Turn[]): boolean {
  const candidate = normalise(reply);

  return history
    .filter((turn) => turn.role === "bot")
    .slice(-3)
    .some((turn) => normalise(turn.text) === candidate);
}

/** The transcript the model sees, oldest first, excluding the message itself. */
function formatHistory(history: readonly Turn[]): string | null {
  const recent = history.slice(-6);
  if (recent.length === 0) return null;

  const lines = recent.map((turn) => `${turn.role === "user" ? "Them" : "You"}: ${turn.text}`);
  return `The conversation so far:\n${lines.join("\n")}`;
}

/**
 * Writes a conversational reply, or returns null so the caller uses a template.
 * Null is a normal outcome, not an error.
 *
 * Every conversational situation comes through here, including greetings and
 * banter. Those two used to be excluded, on the evidence that a 3B model asked
 * to respond to "you're not fun bro" produced "Bro, you're here." — but that
 * evidence was misleading. The classifier had no bucket for banter, so such
 * messages arrived labelled as greetings, and the model was being told to greet
 * someone who was complaining. It answered the instruction it was given.
 *
 * With a chitchat bucket and the last few turns in the prompt, the model answers
 * the actual message, which is the one thing a fixed phrase can never do.
 */
export async function composeReply(context: ReplyContext): Promise<string | null> {
  if (!isNluEnabled()) return null;

  const history = context.history ?? [];
  const register = context.register ?? "standard";
  const who = context.name ? `You are talking to ${context.name}.` : "You do not know their name.";
  const prompt = [
    who,
    formatHistory(history),
    `They have just said: ${JSON.stringify(context.text)}`,
    GUIDANCE[context.situation],
    register === "pidgin" ? PIDGIN_INSTRUCTION : STANDARD_INSTRUCTION,
    "Reply to that message.",
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");

  // Warmer than classification, so the same greeting doesn't come back twice —
  // but only slightly. A 4-bit model sampled at 0.8 degenerates into noise
  // ("Wuzza ya, I cna't tell yna wttrd yrly"), which is far worse than dull.
  const raw = await generateChat("reply", SYSTEM_PROMPT, prompt, { temperature: 0.4, maxTokens: 90 });
  if (raw === null) return null;

  const cleaned = clean(raw);
  const reply = withoutEcho(cleaned, context.text);
  if (reply === null) {
    logger.warn("generated reply only echoed the message", { reply: cleaned, situation: context.situation });
    return null;
  }
  if (MOCK_DIALECT.test(reply) || (register === "standard" && MOCK_DIALECT_IN_ENGLISH.test(reply))) {
    logger.warn("generated reply drifted into mock dialect", { reply, situation: context.situation });
    return null;
  }
  if (!isSafeReply(reply)) {
    logger.warn("generated reply rejected by guardrails", { reply, situation: context.situation });
    return null;
  }
  if (repeatsRecentReply(reply, history)) {
    logger.warn("generated reply repeated an earlier one", { reply, situation: context.situation });
    return null;
  }

  return reply;
}
