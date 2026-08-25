import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import { sniffFileType, type SniffedType } from "./files.js";
import { notifyAdmin } from "./notify.js";
import { recordForReview } from "./review-log.js";

/**
 * What we keep of a receipt, and why.
 *
 * The platform is already storing every image a user sends, and it will hand it
 * back given the handle we were issued. So a receipt we read correctly needs no
 * copy at all — the transaction is in the database, and the handle is there if
 * the picture is ever wanted again. Copying it would be storing a second copy of
 * something already stored, on a machine with less space and no backups.
 *
 * A receipt we failed on is the opposite. It is the evidence for why extraction
 * is wrong, it is what a fixed parser gets re-run against, and it is small in
 * number. Those we keep for real, as bytes on disk.
 */

const FAILED_DIR = resolve(process.cwd(), "storage", "failed-receipts");

const EXTENSIONS: Record<SniffedType, string> = {
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  pdf: "pdf",
  unknown: "bin",
};

export interface FailedReceipt {
  userId: number;
  /** SHA-256 of the file, which is also its filename. */
  hash: string;
  bytes: Buffer;
  /** Why it failed: not a receipt, unreadable amount, OCR error. */
  reason: string;
  /** Which bank the text looked like, when we could tell. Null is itself a finding. */
  bank: string | null;
  /** Whatever extraction did manage to produce, however partial. */
  extraction?: unknown;
}

/**
 * Keeps a failed receipt and puts it in front of the developer.
 *
 * Two destinations, because they serve different jobs: the file on disk is what
 * a fixed parser gets re-run against in bulk, and the notification is what
 * actually gets read. Neither is allowed to throw — a receipt that failed to
 * parse must not also crash the bot.
 */
export async function storeFailedReceipt(failure: FailedReceipt): Promise<string | null> {
  const type = sniffFileType(failure.bytes);
  const filename = `${failure.hash}.${EXTENSIONS[type]}`;
  const path = resolve(FAILED_DIR, filename);

  let savedTo: string | null = null;
  try {
    await mkdir(FAILED_DIR, { recursive: true });
    await writeFile(path, failure.bytes);
    savedTo = path;
  } catch (error) {
    logger.error("could not save failed receipt", { hash: failure.hash, error });
  }

  await recordForReview("extraction-failed", {
    userId: failure.userId,
    hash: failure.hash,
    reason: failure.reason,
    bank: failure.bank,
    file: savedTo,
    extraction: failure.extraction,
  });

  await notifyAdmin({
    title: "⚠️ Extraction failed",
    fields: {
      bank: failure.bank ?? "unrecognised",
      reason: failure.reason,
      user: failure.userId,
      file: filename,
    },
    detail: failure.extraction ? truncate(JSON.stringify(failure.extraction, null, 2), 1500) : undefined,
    image: failure.bytes,
    imageName: filename,
  });

  return savedTo;
}

/** Every failed receipt on disk, for re-running extraction after a fix. */
export async function listFailedReceipts(): Promise<{ path: string; hash: string }[]> {
  try {
    const names = await readdir(FAILED_DIR);
    return names
      .filter((name) => !name.startsWith("."))
      .map((name) => ({ path: resolve(FAILED_DIR, name), hash: name.split(".")[0] }));
  } catch {
    // No directory yet means nothing has failed.
    return [];
  }
}

export async function readFailedReceipt(path: string): Promise<Buffer> {
  return readFile(path);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… (${value.length - limit} more characters)`;
}
