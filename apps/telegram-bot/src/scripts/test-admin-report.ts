import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { env, requireTelegramToken } from "../config/env.js";
import { detectBank } from "../core/banks.js";
import { hashFile } from "../core/files.js";
import { listFailedReceipts, storeFailedReceipt } from "../core/receipt-store.js";
import { createTelegramAdapter } from "../transport/telegram/adapter.js";

/**
 * Exercises the failed-receipt path without needing a real failure.
 *
 * Two things are checked: the file lands on disk, and — if ADMIN_CHAT_ID is
 * configured — the report actually arrives in the channel. The second is worth
 * testing for real rather than assuming, because the whole point of the channel
 * is that it works when you aren't looking at the terminal.
 */

/** A 1x1 red PNG, enough to be a real image file. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function main(): Promise<void> {
  console.log("bank detection");
  for (const [text, expected] of [
    ["Transaction Successful GTBank 737", "GTBank"],
    ["Kuda Microfinance Bank transfer receipt", "Kuda"],
    ["OPay Digital Services transaction", "OPay"],
    ["PalmPay receipt N5,000", "PalmPay"],
    ["Some unbranded receipt", null],
  ] as const) {
    const got = detectBank(text);
    console.log(`  ${got === expected ? "ok  " : "FAIL"} ${JSON.stringify(text).slice(0, 46).padEnd(48)} -> ${got}`);
  }

  console.log("\nadmin reporting");
  if (env.ADMIN_CHAT_ID) {
    console.log(`  sending a real report to ${env.ADMIN_CHAT_ID} …`);
    const adapter = createTelegramAdapter(requireTelegramToken(), async () => null);
    await adapter.start();
    await new Promise((done) => setTimeout(done, 1500));
    await runFailure();
    await new Promise((done) => setTimeout(done, 1500));
    await adapter.stop();
    console.log("  sent — check the channel for the image and the report");
  } else {
    console.log("  ADMIN_CHAT_ID not set, so nothing is sent (this is fine)");
    await runFailure();
  }

  const kept = await listFailedReceipts();
  console.log(`\n  ${kept.length > 0 ? "ok  " : "FAIL"} failed receipt written to disk: ${kept[0]?.path ?? "none"}`);

  // Leave nothing behind — this is a fake failure, not a real one.
  const dir = resolve(process.cwd(), "storage", "failed-receipts");
  for (const name of await readdir(dir).catch(() => [])) {
    if (name.startsWith(hashFile(TINY_PNG).slice(0, 16))) await rm(resolve(dir, name), { force: true });
  }
}

async function runFailure(): Promise<void> {
  await storeFailedReceipt({
    userId: 999000444,
    hash: hashFile(TINY_PNG),
    bytes: TINY_PNG,
    reason: "amount failed validation (test, not a real failure)",
    bank: detectBank("OPay Digital Services transaction successful"),
    extraction: { amount: null, merchant: "OPay Digital Servi", confidence: 0.31 },
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
