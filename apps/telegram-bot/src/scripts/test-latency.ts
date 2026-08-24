import { disposeNlu, warmUpNlu } from "../core/nlu/index.js";
import { understand } from "../core/understand.js";

/**
 * Measures what a user actually waits for.
 *
 * The number that matters is the first message after startup: the system prompt
 * is only evaluated on first use, so without warm-up that one message paid for
 * all ~1,300 tokens of it.
 */
const MESSAGES = ["hi", "thanks", "okk", "how much have I spent", "delete the last one", "what's the weather"];

async function main(): Promise<void> {
  const bootStarted = Date.now();
  const ready = await warmUpNlu();
  const bootMs = Date.now() - bootStarted;

  if (!ready) {
    console.error("Model unavailable — run `npm run model:fetch` first.");
    process.exitCode = 1;
    return;
  }

  console.log(`startup (load + warm-up): ${bootMs}ms — paid once, before the bot serves anyone\n`);

  const timings: number[] = [];
  for (const text of MESSAGES) {
    const started = Date.now();
    const reading = await understand(text);
    const ms = Date.now() - started;
    timings.push(ms);
    console.log(`  ${String(ms).padStart(5)}ms  ${JSON.stringify(text).padEnd(28)} -> ${reading.intent}`);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  console.log(
    `\nper message: first ${timings[0]}ms, median ${sorted[Math.floor(sorted.length / 2)]}ms, ` +
      `slowest ${sorted[sorted.length - 1]}ms`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disposeNlu);
