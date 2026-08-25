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

You are replying to a casual message. Sound like a real person texting back: warm, brief, a bit dry. Not corporate, not bubbly, never a form letter.

Hard rules you must never break:
- Never mention any amount, total, figure or number about their money. You cannot see their data while chatting, so any number you write would be invented.
- Never give financial advice, opinions, warnings, predictions or suggestions about their spending — not even when asked directly, and not even gently. If they ask for advice, say plainly that you don't do that, and say what you do instead.
- Never promise anything you cannot do. You read receipts they send, tell them what they have spent, and remove entries that are wrong. You cannot connect to banks, set budgets, give loans, or track anything they only tell you in words.
- One or two short sentences. No lists. At most one emoji, usually none.
- Answer in the language they used. If they write Pidgin, reply in Pidgin.
- Do not end every message by asking for a receipt. Let the conversation breathe.

Reply with the message text only — no quotes, no labels, no explanation.`;

export interface ReplyContext {
  /** What they said. */
  text: string;
  /** Their first name, when the transport gave us one. */
  name?: string | null;
  /** What the classifier made of the message, to steer the reply. */
  situation:
    | "greeting"
    | "gratitude"
    | "acknowledgement"
    | "capability"
    | "out_of_scope"
    | "not_understood";
}

const GUIDANCE: Record<ReplyContext["situation"], string> = {
  greeting: "They are saying hello or checking you are there. Greet them back briefly.",
  gratitude: "They are thanking you. Accept it in a few words.",
  acknowledgement: "They are acknowledging something with a short 'ok' or similar. Match their brevity — a couple of words is plenty.",
  capability: "They are asking what you can do. Tell them, in one or two sentences, plainly.",
  out_of_scope:
    "They are asking for something you cannot do, or telling you about spending in words rather than sending a receipt. Say so directly without apologising twice, and mention what you can do instead. If they typed out an expense, tell them to send the receipt screenshot and you will log it.",
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

  // A model that starts explaining itself has stopped answering.
  if (/^(sure[,!.]?\s*here|as an ai|i'm an ai|reply:)/i.test(trimmed)) return false;

  return true;
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
 * Which situations the model is actually better at than a fixed phrase.
 *
 * Measured, not assumed. On substantive replies — explaining what it can't do,
 * what it does, why a typed expense won't work — generation wins clearly,
 * because the answer should reflect what was asked and a template can't.
 *
 * On banter it loses. Asked to respond to "you're not fun bro" a 3B model
 * produced "Bro, you're here."; a greeting produced "Yo". Fixed phrasings are
 * better here precisely because a greeting carries no information: "Hey 👋" is
 * a complete answer, and there is nothing for a model to add.
 */
const GENERATED_SITUATIONS = new Set<ReplyContext["situation"]>([
  "capability",
  "out_of_scope",
  "not_understood",
]);

/**
 * Writes a conversational reply, or returns null so the caller uses a template.
 * Null is a normal outcome, not an error.
 */
export async function composeReply(context: ReplyContext): Promise<string | null> {
  if (!isNluEnabled()) return null;
  if (!GENERATED_SITUATIONS.has(context.situation)) return null;

  const who = context.name ? `You are talking to ${context.name}.` : "You do not know their name.";
  const prompt = [
    who,
    `They said: ${JSON.stringify(context.text)}`,
    GUIDANCE[context.situation],
  ].join("\n");

  // Warmer than classification, so the same greeting doesn't come back twice —
  // but only slightly. A 4-bit model sampled at 0.8 degenerates into noise
  // ("Wuzza ya, I cna't tell yna wttrd yrly"), which is far worse than dull.
  const raw = await generateChat("reply", SYSTEM_PROMPT, prompt, { temperature: 0.45, maxTokens: 90 });
  if (raw === null) return null;

  const reply = clean(raw);
  if (!isSafeReply(reply)) {
    logger.warn("generated reply rejected by guardrails", { reply, situation: context.situation });
    return null;
  }

  return reply;
}
