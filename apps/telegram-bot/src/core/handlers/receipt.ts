import { formatBytes, hashFile, sniffFileType } from "../files.js";
import type { IncomingMessage, OutgoingReply } from "../message.js";
import { logger } from "../../logger.js";

/**
 * Receipt pipeline — STUB (steps 4-6).
 *
 * The real pipeline is the ten numbered steps in Section 2: store the raw
 * payload, fast-path dedup on the file hash, OCR, field extraction, validation,
 * the is-this-a-receipt decision, content dedup, categorization, save, reply.
 *
 * For now it reports what it received and what it would do next, so routing can
 * be verified before any extraction exists.
 */
export async function handleReceipt(message: IncomingMessage): Promise<OutgoingReply> {
  const bytes = message.fileBytes;
  if (!bytes) {
    throw new Error("handleReceipt called without file bytes");
  }

  const hash = hashFile(bytes);
  const sniffed = sniffFileType(bytes);

  logger.info("[stub] receipt pipeline", {
    userId: message.userId,
    sniffed,
    bytes: bytes.length,
    sha256: hash.slice(0, 16),
  });

  return {
    text: [
      "📄 Receipt received — extraction isn't built yet (step 4).",
      "",
      `type: ${sniffed}   size: ${formatBytes(bytes.length)}`,
      `hash: ${hash.slice(0, 16)}…`,
    ].join("\n"),
  };
}
