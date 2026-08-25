import { logger } from "../../logger.js";
import { detectBank } from "../banks.js";
import { formatBytes, hashFile, sniffFileType } from "../files.js";
import type { IncomingMessage, OutgoingReply } from "../message.js";
import { extractFields, looksLikeReceipt } from "../receipt/extract.js";
import { extractText, OcrUnavailableError, plainText } from "../receipt/ocr-client.js";
import { storeFailedReceipt } from "../receipt-store.js";
import * as replies from "../replies.js";

/**
 * Receipt pipeline — steps 1 to 6 of Section 2's ten.
 *
 * Reads the file, decides whether it is a receipt at all, and pulls out the
 * fields. What it does NOT yet do is save anything: deduplication,
 * categorisation and storage are steps 5 and 6, so for now it reports what it
 * found rather than logging a transaction.
 *
 * Failures already behave properly, though — a receipt that cannot be read is
 * kept for review and reported to the admin channel, because that log is the
 * evidence for what extraction still gets wrong.
 */
export async function handleReceipt(message: IncomingMessage): Promise<OutgoingReply> {
  const bytes = message.fileBytes;
  if (!bytes) throw new Error("handleReceipt called without file bytes");

  const userId = message.userId;
  const hash = hashFile(bytes);
  const sniffed = sniffFileType(bytes);

  logger.info("receipt received", { userId, sniffed, bytes: bytes.length, hash: hash.slice(0, 16) });

  let ocr;
  try {
    ocr = await extractText(bytes, message.mimeType);
  } catch (error) {
    // The engine being down is our problem, not a bad receipt — say so honestly
    // and keep the file so nothing is lost while it is fixed.
    if (error instanceof OcrUnavailableError) {
      logger.error("OCR unavailable", { userId, error });
      await storeFailedReceipt({
        userId,
        hash,
        bytes,
        reason: "ocr service unavailable",
        bank: null,
      });
      return { text: replies.pick("error", replies.GENERIC_ERROR, userId) };
    }
    throw error;
  }

  const text = plainText(ocr);
  const bank = detectBank(text);

  // Section 8: is this actually a receipt? Decided from the text itself.
  const verdict = looksLikeReceipt(ocr);
  if (!verdict.isReceipt) {
    logger.info("not a receipt", { userId, reason: verdict.reason });
    await storeFailedReceipt({
      userId,
      hash,
      bytes,
      reason: `not a receipt: ${verdict.reason}`,
      bank,
      extraction: { lines: ocr.lines.slice(0, 20) },
    });
    return { text: replies.pick("unsupported", replies.UNSUPPORTED_MEDIA, userId) };
  }

  const fields = extractFields(ocr);

  // Section 8: looks like a receipt, but the amount couldn't be read. Don't
  // guess and don't silently drop it — ask for a clearer image.
  if (!fields.amountKobo) {
    logger.warn("amount not extracted", { userId, bank });
    await storeFailedReceipt({
      userId,
      hash,
      bytes,
      reason: "amount could not be read",
      bank,
      extraction: { lines: ocr.lines, fields: summarise(fields) },
    });
    return {
      text: "I can see that's a receipt, but I couldn't make out the amount. Could you send a clearer screenshot?",
    };
  }

  logger.info("receipt extracted", { userId, bank, amountKobo: fields.amountKobo.value });

  const naira = (fields.amountKobo.value / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });
  return {
    text: [
      `📄 Read it — ₦${naira} to ${fields.merchant?.value ?? "unknown"}`,
      "",
      `bank: ${bank ?? "unrecognised"}   type: ${fields.transactionType?.value ?? "—"}`,
      `date: ${fields.transactionDate?.value.toISOString().slice(0, 10) ?? "—"}   ref: ${fields.referenceNumber?.value ?? "—"}`,
      `size: ${formatBytes(bytes.length)}   ${sniffed}`,
      "",
      "Saving, dedup and categorising come next (steps 5-6).",
    ].join("\n"),
  };
}

/** A compact view of what extraction produced, for the failure log. */
function summarise(fields: ReturnType<typeof extractFields>): Record<string, unknown> {
  return {
    amount: fields.amountKobo?.value ?? null,
    merchant: fields.merchant?.value ?? null,
    date: fields.transactionDate?.value ?? null,
    type: fields.transactionType?.value ?? null,
    reference: fields.referenceNumber?.value ?? null,
    currency: fields.currency,
  };
}
