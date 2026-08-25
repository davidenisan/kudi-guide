import type { Turn } from "./conversation.js";
import { composeReply, type Situation } from "./nlu/respond.js";
import * as replies from "./replies.js";
import type { Understanding } from "./understand.js";

/**
 * Every reply with no figure in it.
 *
 * The split this file sits on: anything carrying an amount, merchant, category
 * or total is rendered from a template and filled in from the database, because
 * it must be exact. Everything else — greetings, banter, "you're not fun to chat
 * with", explaining what the bot can't do — is written by the model, because
 * there is no fact at stake and a fixed string cannot answer a specific remark.
 *
 * The templates are still here, and still vary, but only as the fallback for a
 * model that is disabled, slow, or produced something that tripped a guardrail.
 * A failure costs liveliness and nothing else.
 *
 * It lives apart from the router so the conversational path can be exercised
 * without a database — see scripts/test-chat.ts, which replays whole
 * conversations through this exact function.
 */

export interface ConverseInput {
  userId: number;
  text: string;
  userName?: string | null;
  reading: Understanding;
  history: readonly Turn[];
}

/** Which conversational situation a reading amounts to. */
export function situationFor(reading: Understanding): Situation {
  return reading.intent === "unclear" ? reading.unclearReason : reading.smallTalkKind;
}

export async function converse(input: ConverseInput): Promise<string> {
  const situation = situationFor(input.reading);

  const generated = await composeReply({
    text: input.text,
    name: input.userName,
    situation,
    history: input.history,
    register: input.reading.register,
  });

  return generated ?? template(situation, input.reading.register, input.userId);
}

/** The fixed phrasings, used when generation is unavailable. */
function template(situation: Situation, register: "pidgin" | "standard", userId: number): string {
  const byRegister = (standard: readonly string[], pidgin: readonly string[]): readonly string[] =>
    replies.byRegister(register, standard, pidgin);

  switch (situation) {
    case "greeting":
      return replies.pick("small_talk", byRegister(replies.SMALL_TALK, replies.SMALL_TALK_PIDGIN), userId);
    case "gratitude":
      return replies.pick("gratitude", byRegister(replies.GRATITUDE, replies.GRATITUDE_PIDGIN), userId);
    case "acknowledgement":
      return replies.pick("ack", byRegister(replies.ACKNOWLEDGEMENT, replies.ACKNOWLEDGEMENT_PIDGIN), userId);
    case "capability":
      // Kept in standard English — it's the one reply carrying real information.
      return replies.pick("capability", replies.CAPABILITY, userId);
    case "chitchat":
      // No fixed phrase answers a remark about the conversation itself, which is
      // why this situation most wants the generated reply. This is a holding
      // line for when there isn't one.
      return replies.pick("chitchat", byRegister(replies.CHITCHAT, replies.CHITCHAT_PIDGIN), userId);
    case "out_of_scope":
      return replies.pick("out_of_scope", byRegister(replies.OUT_OF_SCOPE, replies.OUT_OF_SCOPE_PIDGIN), userId);
    case "not_understood":
      return replies.pick("unclear", byRegister(replies.UNCLEAR, replies.UNCLEAR_PIDGIN), userId);
  }
}
