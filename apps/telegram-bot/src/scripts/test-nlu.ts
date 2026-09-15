import { classifyIntent } from "../core/intent/classify.js";
import type { Intent } from "../core/intent/patterns.js";
import { disposeNlu, warmUpNlu } from "../core/nlu/index.js";
import { understand } from "../core/understand.js";

/**
 * Measures the local model against the frozen pattern matcher on the same
 * corpus, so the change is justified by numbers rather than by impression.
 *
 * The slang, Pidgin and fragment cases below are real failures observed during
 * testing — the ones that motivated moving off pattern matching.
 */

interface Case {
  text: string;
  expect: Intent;
  /** Undo only: whether it should act directly or ask first. */
  expectAction?: "act" | "confirm";
}

const CASES: Case[] = [
  // --- observed failures: Pidgin and slang --------------------------------
  { text: "whatsup my guy", expect: "small_talk" },
  { text: "how far, how you dey naw", expect: "small_talk" },
  { text: "wetin dey happen", expect: "small_talk" },
  { text: "you sabi read receipt", expect: "small_talk" },
  { text: "how my account dey", expect: "request_summary" },
  { text: "my guy how much i don burn", expect: "request_summary" },
  { text: "wetin remain", expect: "request_summary" },
  { text: "abeg check my spending", expect: "request_summary" },
  { text: "break am down for me", expect: "request_summary" },
  { text: "how much i don waste this month", expect: "request_summary" },
  { text: "comot the thing", expect: "request_undo" },
  { text: "forget the last thing i send", expect: "request_undo" },
  { text: "i no want am again", expect: "request_undo" },
  { text: "abeg no mind that one", expect: "request_undo" },
  { text: "that one no correct", expect: "request_undo" },
  { text: "biko remove it", expect: "request_undo" },
  { text: "abeg comot am", expect: "request_undo" },

  // --- ordinary English ---------------------------------------------------
  { text: "how much have I spent this month", expect: "request_summary" },
  { text: "what's my spending looking like", expect: "request_summary" },
  { text: "what am I spending most on", expect: "request_summary" },
  { text: "summary", expect: "request_summary" },
  { text: "how much did I use on food", expect: "request_summary" },
  { text: "give me a breakdown", expect: "request_summary" },
  { text: "where is my money going", expect: "request_summary" },
  { text: "remove that", expect: "request_undo" },
  { text: "that one was wrong", expect: "request_undo" },
  { text: "delete the last one", expect: "request_undo", expectAction: "act" },
  { text: "undo the last transaction", expect: "request_undo", expectAction: "act" },
  { text: "take that out", expect: "request_undo" },
  { text: "I sent the wrong one", expect: "request_undo" },
  { text: "that shouldn't be there", expect: "request_undo" },

  // --- typos and fragments ------------------------------------------------
  { text: "how much have i spnet this month", expect: "request_summary" },
  { text: "sumary", expect: "request_summary" },
  { text: "my expences", expect: "request_summary" },
  { text: "delet the last one", expect: "request_undo" },
  { text: "remvoe that", expect: "request_undo" },
  { text: "that was worng", expect: "request_undo" },

  // --- small talk ---------------------------------------------------------
  { text: "hi", expect: "small_talk" },
  { text: "okk", expect: "small_talk" },
  { text: "hii", expect: "small_talk" },
  { text: "good morning", expect: "small_talk" },
  { text: "you there?", expect: "small_talk" },
  { text: "thanks", expect: "small_talk" },
  { text: "thanx", expect: "small_talk" },
  { text: "how are you", expect: "small_talk" },
  { text: "what can you do", expect: "small_talk" },
  { text: "help", expect: "small_talk" },
  { text: "who are you", expect: "small_talk" },

  // --- must ask before deleting ------------------------------------------
  { text: "wrong", expect: "request_undo", expectAction: "confirm" },
  { text: "mistake", expect: "request_undo", expectAction: "confirm" },

  // --- out of scope: must not be forced into an intent --------------------
  { text: "what is the weather", expect: "unclear" },
  { text: "5000", expect: "unclear" },
  { text: "gjkl", expect: "unclear" },
  { text: "gi]\\", expect: "unclear" },
  { text: "qwerty", expect: "unclear" },
  { text: "vdfge0300-[']]", expect: "unclear" },
  { text: "skdos0=====", expect: "unclear" },
  { text: "sdffdfgva", expect: "unclear" },
  { text: "zzzz", expect: "unclear" },
  { text: "aaaaa", expect: "unclear" },
  { text: "....", expect: "unclear" },
  { text: "asdfgh", expect: "unclear" },
  { text: "can you connect to my bank account", expect: "unclear" },
  { text: "I need a loan", expect: "unclear" },
  { text: "send me my dashboard link", expect: "unclear" },
  { text: "should I stop buying takeout", expect: "unclear" },
  { text: "set me a budget of 50k", expect: "unclear" },
];

async function main(): Promise<void> {
  const ready = await warmUpNlu();
  if (!ready) {
    console.error("Model unavailable — run `npm run model:fetch` first.");
    process.exitCode = 1;
    return;
  }

  let llmCorrect = 0;
  let patternCorrect = 0;
  let fellBack = 0;
  const latencies: number[] = [];
  const failures: string[] = [];

  console.log("message".padEnd(38) + "expected".padEnd(18) + "llm".padEnd(18) + "patterns");
  console.log("-".repeat(92));

  for (const testCase of CASES) {
    const started = Date.now();
    const reading = await understand(testCase.text);
    latencies.push(Date.now() - started);
    if (reading.source === "patterns") fellBack += 1;

    const pattern = classifyIntent(testCase.text).intent;

    const actionOk = testCase.expectAction === undefined || reading.action === testCase.expectAction;
    const llmOk = reading.intent === testCase.expect && actionOk;
    const patternOk = pattern === testCase.expect;

    if (llmOk) llmCorrect += 1;
    if (patternOk) patternCorrect += 1;
    if (!llmOk) {
      failures.push(
        `  ${JSON.stringify(testCase.text)} — expected ${testCase.expect}` +
          `${testCase.expectAction ? `/${testCase.expectAction}` : ""}, got ${reading.intent}/${reading.action}`,
      );
    }

    const mark = (ok: boolean): string => (ok ? " " : "✗");
    console.log(
      testCase.text.slice(0, 36).padEnd(38) +
        testCase.expect.padEnd(18) +
        `${mark(llmOk)}${reading.intent}`.padEnd(18) +
        `${mark(patternOk)}${pattern}`,
    );
  }

  const total = CASES.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  console.log("\n" + "=".repeat(52));
  console.log(`  local model:     ${llmCorrect}/${total}  (${Math.round((llmCorrect / total) * 100)}%)`);
  console.log(`  pattern matcher: ${patternCorrect}/${total}  (${Math.round((patternCorrect / total) * 100)}%)`);
  console.log(`  fell back to patterns: ${fellBack}`);
  console.log(`  latency: median ${median}ms, max ${sorted[sorted.length - 1]}ms`);

  if (failures.length > 0) {
    console.log("\nModel got these wrong:");
    for (const failure of failures) console.log(failure);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disposeNlu);
