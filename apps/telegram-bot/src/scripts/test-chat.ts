import { converse, situationFor } from "../core/converse.js";
import { rememberBotReply, rememberUserMessage, recentTurns, clearTranscript } from "../core/conversation.js";
import { disposeNlu, warmUpNlu } from "../core/nlu/index.js";
import { understand } from "../core/understand.js";

/**
 * Replays whole conversations through the real conversational path.
 *
 * Intent accuracy is measured elsewhere (test:nlu). What this script shows is
 * the thing that accuracy score misses entirely: whether the bot sounds like
 * anyone. Every case below is a multi-turn exchange, because the failures worth
 * catching here only appear in sequence — the same canned line twice running, a
 * greeting in answer to a complaint, a follow-up read as if it arrived cold.
 *
 * The first two conversations are transcribed from real testing, including the
 * exchange that prompted this work: a tester saying the bot was no fun to chat
 * with, twice, and being waved at both times.
 *
 * There is no pass/fail here and there shouldn't be — you read it. Nothing
 * touches the database, so it runs on the model alone.
 */

interface Conversation {
  title: string;
  /** Their first name, as the transport would supply it. */
  name?: string;
  messages: string[];
}

const CONVERSATIONS: Conversation[] = [
  {
    title: "the transcript that prompted this — banter, not requests",
    name: "Finney",
    messages: ["yoo yoo yoo", "you arent fun to chat with frfr", "so you aren't fun to chat with", "why now"],
  },
  {
    title: "reacting to what the bot just said",
    name: "Finney",
    messages: ["what can you do", "that's it?", "no vex, i thought you fit do more"],
  },
  {
    title: "pidgin throughout — the reply must stay in register",
    messages: ["how far", "you dey there?", "you no dey talk like person o", "abeg wetin you sabi do"],
  },
  {
    title: "out of scope, asked three ways",
    messages: ["can you connect to my bank account", "why not", "ok so what about a budget"],
  },
  {
    title: "a typed expense, then the follow-up",
    messages: ["i spent 4000 on transport", "so how do i add it"],
  },
  {
    title: "requests still route to the handlers, not to chat",
    messages: ["how much have i spent this month", "break am down for me", "abeg comot am"],
  },
  {
    title: "a real follow-up request must still reach the summary handler",
    messages: ["how much have i spent", "and last month?"],
  },
  {
    title: "acknowledgement should stay short and not restart the conversation",
    messages: ["thanks", "okk", "👍"],
  },
];

/** The user id keeps each conversation's transcript separate. */
let nextUserId = 900100;

async function replay(conversation: Conversation): Promise<void> {
  const userId = nextUserId++;
  clearTranscript(userId);

  console.log(`\n${"─".repeat(72)}\n${conversation.title}\n${"─".repeat(72)}`);

  for (const text of conversation.messages) {
    const history = recentTurns(userId);
    const started = Date.now();
    const reading = await understand(text, history);

    // Only the conversational intents are exercised here. A summary or undo
    // goes to a handler that reads the database, which this script deliberately
    // does not touch — the line is printed so you can see it routed correctly.
    const conversational = reading.intent === "small_talk" || reading.intent === "unclear";
    const reply = conversational
      ? await converse({ userId, text, userName: conversation.name, reading, history })
      : `[routed to the ${reading.intent === "request_summary" ? "summary" : "undo"} handler — no chat generated]`;

    const ms = Date.now() - started;
    const label = conversational ? situationFor(reading) : reading.intent;

    console.log(`\n  them  ${text}`);
    console.log(`  bot   ${reply}`);
    console.log(`        ↳ ${label}, ${reading.register}, ${reading.confidence} confidence, ${ms}ms`);

    rememberUserMessage(userId, text);
    rememberBotReply(userId, reply);
  }
}

async function main(): Promise<void> {
  const ready = await warmUpNlu();
  if (!ready) {
    console.error("Model unavailable — run `npm run model:fetch` first.");
    process.exitCode = 1;
    return;
  }

  for (const conversation of CONVERSATIONS) await replay(conversation);
  console.log("");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disposeNlu);
