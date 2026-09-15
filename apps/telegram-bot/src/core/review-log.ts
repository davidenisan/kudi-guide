import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { logger } from "../logger.js";

/**
 * The review log — the record of everything the bot could not handle.
 *
 * Section 3 asks for every `unclear` message to be logged, because that log is
 * the evidence for whether a local model is needed at all. Section 8 asks for
 * every rejected or failed extraction to be logged for the same reason. Both go
 * here, as JSON lines, one file per kind.
 *
 * This is deliberately a file and not a third collection (Section 4).
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage", "review");

export type ReviewKind = "unclear" | "rejected-receipt" | "extraction-failed" | "low-confidence" | "messages";

export async function recordForReview(kind: ReviewKind, entry: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  const path = resolve(STORAGE_ROOT, `${kind}.jsonl`);

  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${line}\n`, "utf8");
  } catch (error) {
    // Never let a logging failure break message handling.
    logger.error("could not write review log", { kind, error });
  }
}

export function reviewLogPath(kind: ReviewKind): string {
  return resolve(STORAGE_ROOT, `${kind}.jsonl`);
}
