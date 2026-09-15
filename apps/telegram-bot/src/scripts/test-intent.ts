import {
  ACT_THRESHOLD,
  classifyConfirmation,
  classifyIntent,
  smallTalkFlavor,
  type Intent,
  type SmallTalkFlavor,
} from "../core/intent/classify.js";

/**
 * Accuracy harness for the intent classifier.
 *
 * Section 3 says to log every unclear message during testing, because that log
 * is the evidence for whether a local model is needed at all. This is the same
 * idea applied before real users arrive: a labelled corpus that says plainly how
 * well pattern matching does, so the decision is measured rather than assumed.
 *
 * Add real tester phrasings here as they come in — especially misclassified ones.
 */

interface Case {
  text: string;
  expect: Intent;
  /**
   * For undo, whether the message should be acted on directly or confirmed
   * first. A single ambiguous word must never reach "act" — that is the
   * difference between a safe misread and a deleted transaction.
   */
  expectAction?: "act" | "confirm";
  /** For small talk, which of the four things to say back. */
  expectFlavor?: SmallTalkFlavor;
  note?: string;
}

const CASES: Case[] = [
  // --- Section 3's own examples ------------------------------------------
  { text: "how much have I spent this month", expect: "request_summary", note: "spec example" },
  { text: "what's my spending looking like", expect: "request_summary", note: "spec example" },
  { text: "what am I spending most on", expect: "request_summary", note: "spec example" },
  { text: "summary", expect: "request_summary", note: "spec example" },
  { text: "how much did I use on food", expect: "request_summary", note: "spec example" },
  { text: "remove that", expect: "request_undo", note: "spec example" },
  { text: "that one was wrong", expect: "request_undo", note: "spec example" },
  { text: "delete the last one", expect: "request_undo", note: "spec example" },
  { text: "undo the last transaction", expect: "request_undo", note: "spec example" },

  // --- summary, natural variation ----------------------------------------
  { text: "how much did I spend", expect: "request_summary" },
  { text: "How much have I spent so far?", expect: "request_summary" },
  { text: "whats my total this month", expect: "request_summary" },
  { text: "give me a breakdown", expect: "request_summary" },
  { text: "show me my spending", expect: "request_summary" },
  { text: "where is my money going", expect: "request_summary" },
  { text: "what have I spent on transport", expect: "request_summary" },
  { text: "my expenses please", expect: "request_summary" },
  { text: "spending summary", expect: "request_summary" },
  { text: "how much on food this month", expect: "request_summary" },
  { text: "can I see my spending", expect: "request_summary" },
  { text: "total spent", expect: "request_summary" },

  // --- summary, Nigerian phrasing ----------------------------------------
  { text: "how much I don spend", expect: "request_summary" },
  { text: "wetin I don spend this month", expect: "request_summary" },
  { text: "abeg how much I don use", expect: "request_summary" },

  // --- summary, typos ----------------------------------------------------
  { text: "how much have i spnet this month", expect: "request_summary", note: "typo" },
  { text: "sumary", expect: "request_summary", note: "typo" },
  { text: "spendin breakdown", expect: "request_summary", note: "typo" },
  { text: "my expences", expect: "request_summary", note: "typo" },

  // --- undo, natural variation -------------------------------------------
  { text: "that was wrong", expect: "request_undo" },
  { text: "take that out", expect: "request_undo" },
  { text: "cancel that", expect: "request_undo" },
  { text: "delete it", expect: "request_undo" },
  { text: "remove the last one please", expect: "request_undo" },
  { text: "that wasn't right", expect: "request_undo" },
  { text: "the last entry is wrong", expect: "request_undo" },
  { text: "I sent the wrong one", expect: "request_undo" },
  { text: "undo", expect: "request_undo", expectAction: "act" },
  { text: "that shouldn't be there", expect: "request_undo" },
  { text: "forget that one", expect: "request_undo" },
  { text: "oops delete that", expect: "request_undo", expectAction: "act" },
  { text: "delete the last one", expect: "request_undo", expectAction: "act" },
  { text: "undo the last transaction", expect: "request_undo", expectAction: "act" },

  // --- undo that must ASK before acting (Section 3) -----------------------
  { text: "wrong", expect: "request_undo", expectAction: "confirm", note: "one ambiguous word" },
  { text: "mistake", expect: "request_undo", expectAction: "confirm", note: "one ambiguous word" },
  { text: "that's incorrect", expect: "request_undo", expectAction: "confirm", note: "no explicit action word" },

  // --- undo, Nigerian phrasing -------------------------------------------
  { text: "abeg comot that one", expect: "request_undo" },
  { text: "e no correct", expect: "request_undo" },
  { text: "remove am", expect: "request_undo" },

  // --- undo, typos -------------------------------------------------------
  { text: "delet the last one", expect: "request_undo", note: "typo" },
  { text: "remvoe that", expect: "request_undo", note: "typo" },
  { text: "that was worng", expect: "request_undo", note: "typo" },

  // --- small talk: greetings ---------------------------------------------
  { text: "hi", expect: "small_talk", expectFlavor: "greeting" },
  { text: "hello", expect: "small_talk", expectFlavor: "greeting" },
  { text: "good morning", expect: "small_talk", expectFlavor: "greeting" },
  { text: "how far", expect: "small_talk", expectFlavor: "greeting" },
  { text: "you there?", expect: "small_talk", expectFlavor: "greeting" },
  { text: "how are you", expect: "small_talk", expectFlavor: "greeting" },
  { text: "hey 👋", expect: "small_talk", expectFlavor: "greeting" },

  // --- small talk: chat spelling that fuzzy matching has to survive -------
  { text: "hii", expect: "small_talk", expectFlavor: "greeting", note: "elongation" },
  { text: "heyy", expect: "small_talk", expectFlavor: "greeting", note: "elongation" },
  { text: "hellooo", expect: "small_talk", expectFlavor: "greeting", note: "elongation" },

  // --- small talk: gratitude ---------------------------------------------
  { text: "thanks", expect: "small_talk", expectFlavor: "gratitude" },
  { text: "thank you", expect: "small_talk", expectFlavor: "gratitude" },
  { text: "thankss", expect: "small_talk", expectFlavor: "gratitude", note: "elongation" },
  { text: "thanx", expect: "small_talk", expectFlavor: "gratitude", note: "abbreviation" },
  { text: "tnx", expect: "small_talk", expectFlavor: "gratitude", note: "abbreviation" },
  { text: "nice one", expect: "small_talk", expectFlavor: "gratitude" },
  { text: "🙏", expect: "small_talk", expectFlavor: "gratitude", note: "bare emoji" },

  // --- small talk: acknowledgement, not a greeting ------------------------
  { text: "ok", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "okk", expect: "small_talk", expectFlavor: "acknowledgement", note: "the one from testing" },
  { text: "okkk", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "k", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "kk", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "got it", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "alright", expect: "small_talk", expectFlavor: "acknowledgement" },
  { text: "👍", expect: "small_talk", expectFlavor: "acknowledgement", note: "bare emoji" },
  { text: "👌", expect: "small_talk", expectFlavor: "acknowledgement", note: "bare emoji" },

  // --- small talk: capability questions -----------------------------------
  { text: "help", expect: "small_talk", expectFlavor: "capability" },
  { text: "what can you do", expect: "small_talk", expectFlavor: "capability" },
  { text: "what do you do", expect: "small_talk", expectFlavor: "capability" },
  { text: "how does this work", expect: "small_talk", expectFlavor: "capability" },
  { text: "who are you", expect: "small_talk", expectFlavor: "capability" },
  { text: "what should I send", expect: "small_talk", expectFlavor: "capability" },

  // --- small talk: pidgin --------------------------------------------------
  { text: "u dey there", expect: "small_talk", expectFlavor: "greeting" },
  { text: "you dey", expect: "small_talk", expectFlavor: "greeting" },
  { text: "are you working", expect: "small_talk", expectFlavor: "greeting" },

  // --- more real phrasings that used to fall through ----------------------
  { text: "check my spending", expect: "request_summary" },
  { text: "my money", expect: "request_summary" },
  { text: "how much on transport", expect: "request_summary" },
  { text: "food spending", expect: "request_summary" },
  { text: "wats my total", expect: "request_summary" },
  { text: "hw much i spend", expect: "request_summary", note: "abbreviation" },
  { text: "clear that", expect: "request_undo" },
  { text: "erase that", expect: "request_undo" },
  { text: "scrap that", expect: "request_undo" },
  { text: "take it off", expect: "request_undo" },
  { text: "undo last", expect: "request_undo" },
  { text: "i sent wrong receipt", expect: "request_undo", note: "was an ambiguous tie" },
  { text: "remove the last receipt", expect: "request_undo" },

  // --- unclear: must not be forced into a guess --------------------------
  { text: "what is the weather", expect: "unclear" },
  { text: "5000", expect: "unclear" },
  { text: "asdfgh", expect: "unclear" },
  { text: "can you connect to my bank account", expect: "unclear" },
  { text: "who built you", expect: "unclear" },
  { text: "I need a loan", expect: "unclear" },
  { text: "send me my dashboard link", expect: "unclear" },
];

/** Replies to a confirm-before-undo question. Anything unsure must be "unclear". */
const CONFIRMATION_CASES: { text: string; expect: "yes" | "no" | "unclear"; note?: string }[] = [
  { text: "yes", expect: "yes" },
  { text: "yes please", expect: "yes" },
  { text: "yeah that one", expect: "yes" },
  { text: "go ahead", expect: "yes" },
  { text: "correct", expect: "yes" },
  { text: "no", expect: "no" },
  { text: "nope", expect: "no" },
  { text: "leave it", expect: "no" },
  { text: "never mind", expect: "no" },
  { text: "no leave it", expect: "no" },
  { text: "hmm", expect: "unclear" },
  { text: "what do you mean", expect: "unclear" },
  { text: "the jumia one", expect: "unclear", note: "not a clear yes — must not delete" },
];

function main(): void {
  let passed = 0;
  const failures: { text: string; expected: string; got: string; confidence: number; matched: string[] }[] = [];

  console.log("Intent classification\n");
  for (const testCase of CASES) {
    const result = classifyIntent(testCase.text);
    const action = result.confidence >= ACT_THRESHOLD ? "act" : "confirm";
    const flavor = result.intent === "small_talk" ? smallTalkFlavor(testCase.text) : undefined;

    const ok =
      result.intent === testCase.expect &&
      (testCase.expectAction === undefined || action === testCase.expectAction) &&
      (testCase.expectFlavor === undefined || flavor === testCase.expectFlavor);

    if (ok) {
      passed += 1;
    } else {
      const suffix = (value: string): string =>
        testCase.expectAction ? `${value}/${action}` : testCase.expectFlavor ? `${value}/${flavor ?? "—"}` : value;
      failures.push({
        text: testCase.text,
        expected: testCase.expectAction
          ? `${testCase.expect}/${testCase.expectAction}`
          : testCase.expectFlavor
            ? `${testCase.expect}/${testCase.expectFlavor}`
            : testCase.expect,
        got: suffix(result.intent),
        confidence: result.confidence,
        matched: result.matched,
      });
    }
    const flag = ok ? "  ok  " : "  FAIL";
    const label = flavor ? `${result.intent}:${flavor}` : result.intent;
    console.log(
      `${flag} ${JSON.stringify(testCase.text).padEnd(38)} -> ${label.padEnd(28)} ` +
        `${result.confidence.toFixed(2)} ${result.intent === "unclear" ? "" : action}`,
    );
  }

  console.log(`\nIntent: ${passed}/${CASES.length} correct`);

  let confirmPassed = 0;
  console.log("\nConfirmation replies\n");
  for (const testCase of CONFIRMATION_CASES) {
    const result = classifyConfirmation(testCase.text);
    const ok = result === testCase.expect;
    if (ok) confirmPassed += 1;
    console.log(`${ok ? "  ok  " : "  FAIL"} ${JSON.stringify(testCase.text).padEnd(24)} -> ${result}`);
  }
  console.log(`\nConfirmation: ${confirmPassed}/${CONFIRMATION_CASES.length} correct`);

  if (failures.length > 0) {
    console.log("\nMisclassified:");
    for (const failure of failures) {
      console.log(
        `  ${JSON.stringify(failure.text)}\n` +
          `    expected ${failure.expected}, got ${failure.got} (${failure.confidence.toFixed(2)})` +
          `${failure.matched.length > 0 ? ` via [${failure.matched.join(", ")}]` : ""}`,
      );
    }
  }

  const allPassed = failures.length === 0 && confirmPassed === CONFIRMATION_CASES.length;
  if (!allPassed) process.exitCode = 1;
}

main();
