import { createHash } from "node:crypto";

/**
 * File helpers used by the receipt pipeline. Transport-independent: these see
 * bytes, never a file id.
 */

/** SHA-256 of the raw bytes — the `source_receipt_hash` used for fast dedup (Section 7). */
export function hashFile(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type SniffedType = "jpeg" | "png" | "gif" | "webp" | "pdf" | "unknown";

/**
 * Identifies a file from its magic bytes rather than trusting the declared mime
 * type. A document can arrive labelled anything, and OCR on bytes that are not
 * actually an image is a confusing way to fail.
 */
export function sniffFileType(bytes: Buffer): SniffedType {
  if (bytes.length < 12) return "unknown";

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return "unknown";
}

export function formatBytes(count: number): string {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
  return `${(count / (1024 * 1024)).toFixed(2)} MB`;
}
