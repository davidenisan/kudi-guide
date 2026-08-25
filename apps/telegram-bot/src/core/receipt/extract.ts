import { detectBank } from "../banks.js";
import { plainText, type OcrLine, type OcrResult } from "./ocr-client.js";

/**
 * Turning OCR output into fields, by anchoring on labels rather than positions.
 *
 * The spec is emphatic about what not to do here: no gtbank.ts, no opay.ts, no
 * per-bank templates. Every Nigerian banking app labels its fields — they just
 * arrange them differently — so the rule is "find the word Amount, then take the
 * money-shaped number nearest to it", which survives a redesign where a
 * line-index template does not.
 *
 * Everything is nullable and nothing is invented. A field that cannot be read
 * confidently comes back null, and the pipeline asks rather than guesses.
 */

export interface ExtractedField<T> {
  value: T;
  /** 0..1. Combines OCR confidence with how sure we are of the label match. */
  confidence: number;
  /** The line this came from, for debugging a bad parse. */
  sourceText: string;
}

export interface ExtractedReceipt {
  amountKobo: ExtractedField<number> | null;
  merchant: ExtractedField<string> | null;
  transactionDate: ExtractedField<Date> | null;
  transactionType: ExtractedField<string> | null;
  referenceNumber: ExtractedField<string> | null;
  sender: ExtractedField<string> | null;
  currency: string | null;
  bank: string | null;
  /** Everything the engine returned. Stored on every transaction (Section 4). */
  raw: OcrResult;
}

// ---------------------------------------------------------------------------
// label vocabularies
// ---------------------------------------------------------------------------

/**
 * What each field is called across Nigerian banks and fintechs. Adding a synonym
 * is not a per-bank template — the extraction rule is identical for all of them,
 * this is only the vocabulary it searches for.
 */
const LABELS = {
  amount: ["amount", "amount paid", "amount sent", "total", "total amount", "transaction amount", "value", "debit"],
  merchant: [
    "recipient",
    "recipient name",
    "receiver",
    "beneficiary",
    "beneficiary name",
    "paid to",
    "to",
    "merchant",
    "payee",
    "credit to",
    "recipient details",
  ],
  date: ["date", "transaction date", "date and time", "date & time", "payment date", "time", "transaction time"],
  reference: [
    "reference",
    "reference number",
    "transaction reference",
    "transaction ref",
    "ref",
    "ref no",
    "transaction id",
    "transaction no",
    "session id",
    "session",
    "payment reference",
    "receipt no",
  ],
  type: ["transaction type", "type", "transaction", "payment type", "channel"],
  sender: ["sender", "sender name", "from", "paid from", "payer", "debit account", "source account"],
} as const;

/** Words that mean this is a payment receipt rather than any other screenshot. */
const RECEIPT_MARKERS = [
  "transaction",
  "successful",
  "amount",
  "reference",
  "transfer",
  "recipient",
  "session",
  "receipt",
  "payment",
  "paid",
  "debit",
  "credit",
  "balance",
  "beneficiary",
];

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function centre(line: OcrLine): { x: number; y: number } | null {
  if (!line.box) return null;
  return {
    x: (line.box.left + line.box.right) / 2,
    y: (line.box.top + line.box.bottom) / 2,
  };
}

/**
 * How near a candidate is to its label, in reading order.
 *
 * Bank apps put the value either directly beneath the label or on the same line
 * to the right, so both are cheap; anything above the label is almost certainly
 * a different field and is pushed far away. Vertical distance dominates because
 * a value two rows down is much less likely to belong to this label than one
 * sitting to its right.
 */
function proximity(label: OcrLine, candidate: OcrLine): number {
  const a = centre(label);
  const b = centre(candidate);
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const dy = b.y - a.y;
  const dx = Math.abs(b.x - a.x);

  // Above the label: wrong direction for every layout we care about.
  if (dy < -8) return Number.POSITIVE_INFINITY;

  return Math.abs(dy) * 2 + dx * 0.5;
}

// ---------------------------------------------------------------------------
// label matching
// ---------------------------------------------------------------------------

function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface LabelHit {
  line: OcrLine;
  index: number;
  /** How exact the match was — an exact label beats one embedded in a sentence. */
  quality: number;
}

function findLabels(lines: OcrLine[], vocabulary: readonly string[]): LabelHit[] {
  const hits: LabelHit[] = [];

  lines.forEach((line, index) => {
    const normalized = normalizeLabel(line.text);
    if (normalized === "") return;

    for (const label of vocabulary) {
      if (normalized === label) {
        hits.push({ line, index, quality: 1 });
        return;
      }
      // "Amount Paid:" and "Amount: N5,000" both anchor as well as a bare label.
      if (normalized.startsWith(`${label} `) || normalized.endsWith(` ${label}`)) {
        hits.push({ line, index, quality: 0.85 });
        return;
      }
      if (normalized.includes(label) && normalized.length <= label.length + 12) {
        hits.push({ line, index, quality: 0.7 });
        return;
      }
    }
  });

  return hits.sort((a, b) => b.quality - a.quality);
}

/**
 * The value belonging to a label: on the same line after a colon, or the nearest
 * line below or to the right.
 */
function valueFor(
  lines: OcrLine[],
  hits: LabelHit[],
  accept: (text: string) => boolean,
): { line: OcrLine; text: string; quality: number } | null {
  for (const hit of hits) {
    // Same line: "Amount: N12,500" or "Amount  N12,500".
    const inline = afterLabel(hit.line.text);
    if (inline && accept(inline)) {
      return { line: hit.line, text: inline, quality: hit.quality };
    }

    const candidates = lines
      .filter((line) => line !== hit.line && accept(line.text))
      .map((line) => ({ line, distance: proximity(hit.line, line) }))
      .filter((entry) => Number.isFinite(entry.distance))
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length > 0) {
      return { line: candidates[0].line, text: candidates[0].line.text, quality: hit.quality };
    }
  }
  return null;
}

/** The part of a line after "Label:" — empty when the line is only a label. */
function afterLabel(text: string): string | null {
  const match = /^[^:]{1,40}:\s*(.+)$/.exec(text.trim());
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// value shapes
// ---------------------------------------------------------------------------

/**
 * A money amount. Requires a currency marker or proper digit grouping, so a
 * reference number or a date cannot be mistaken for one.
 */
const MONEY = /(?:₦|N|NGN)?\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})/i;

function looksLikeMoney(text: string): boolean {
  return MONEY.test(text.replace(/\s+/g, " "));
}

/**
 * Parses to integer kobo. Never floats — a naira float loses the last kobo to
 * binary rounding, and this is the field the spec says to be paranoid about.
 */
export function parseAmountToKobo(text: string): number | null {
  const match = MONEY.exec(text.replace(/\s+/g, " "));
  if (!match) return null;

  const cleaned = match[1].replace(/[,\s]/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  if (whole === "" || !/^\d+$/.test(whole)) return null;

  const kobo = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

const REFERENCE = /\b([A-Z0-9]{6,32})\b/;

function looksLikeReference(text: string): boolean {
  const candidate = text.trim().toUpperCase();
  if (!REFERENCE.test(candidate)) return false;
  // A plain number with grouping is money; a bare short number is not a ref.
  if (/^\d{1,3}([,\s]\d{3})+/.test(candidate)) return false;
  return true;
}

function looksLikeDate(text: string): boolean {
  return parseReceiptDate(text) !== null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Nigerian receipts write dates several ways. Day-first is assumed for the
 * numeric forms, which is the local convention.
 */
export function parseReceiptDate(text: string, now: Date = new Date()): Date | null {
  const cleaned = text.replace(/\s+/g, " ").trim();

  // 25 Aug 2026 / Aug 25, 2026 / 25-Aug-2026
  const named = /(\d{1,2})[\s\-/]*([a-z]{3,9})[\s\-/,]*(\d{4})|([a-z]{3,9})[\s\-/]*(\d{1,2})[\s\-/,]*(\d{4})/i.exec(cleaned);
  if (named) {
    const day = Number(named[1] ?? named[5]);
    const monthName = (named[2] ?? named[4] ?? "").toLowerCase().slice(0, 4);
    const year = Number(named[3] ?? named[6]);
    const month = MONTHS[monthName] ?? MONTHS[monthName.slice(0, 3)];
    if (month !== undefined && day >= 1 && day <= 31) {
      return finish(new Date(Date.UTC(year, month, day)), cleaned, now);
    }
  }

  // 25/08/2026 or 25-08-26, day first.
  const numeric = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/.exec(cleaned);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return finish(new Date(Date.UTC(year, month, day)), cleaned, now);
    }
  }

  return null;
}

/** Adds the time of day when the line carries one, and rejects future dates. */
function finish(date: Date, text: string, now: Date): Date | null {
  const time = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (time) {
    let hours = Number(time[1]);
    const meridiem = time[4]?.toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    date.setUTCHours(hours, Number(time[2]), Number(time[3] ?? 0));
  }

  // A receipt cannot be from the future; a date that parses to one is a misread.
  // A day's grace covers timezone skew on a receipt from this evening.
  if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return null;
  return date;
}

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

function field<T>(value: T, ocrConfidence: number, quality: number, sourceText: string): ExtractedField<T> {
  return {
    value,
    confidence: Math.min(1, ocrConfidence * quality),
    sourceText,
  };
}

export function extractFields(result: OcrResult): ExtractedReceipt {
  const lines = result.lines;
  const text = plainText(result);

  // A PDF's own text layer is exact; OCR confidence is only meaningful for pixels.
  const trust = (line: OcrLine): number => (result.source === "pdf-text-layer" ? 1 : line.confidence);

  const amountHit = valueFor(lines, findLabels(lines, LABELS.amount), looksLikeMoney);
  const amountKobo = amountHit ? parseAmountToKobo(amountHit.text) : null;

  const dateHit = valueFor(lines, findLabels(lines, LABELS.date), looksLikeDate);
  const parsedDate = dateHit ? parseReceiptDate(dateHit.text) : null;

  const referenceHit = valueFor(lines, findLabels(lines, LABELS.reference), looksLikeReference);
  const merchantHit = valueFor(lines, findLabels(lines, LABELS.merchant), isNameLike);
  const typeHit = valueFor(lines, findLabels(lines, LABELS.type), isNameLike);
  const senderHit = valueFor(lines, findLabels(lines, LABELS.sender), isNameLike);

  return {
    amountKobo:
      amountHit && amountKobo !== null
        ? field(amountKobo, trust(amountHit.line), amountHit.quality, amountHit.text)
        : null,
    merchant: merchantHit ? field(cleanName(merchantHit.text), trust(merchantHit.line), merchantHit.quality, merchantHit.text) : null,
    transactionDate: dateHit && parsedDate ? field(parsedDate, trust(dateHit.line), dateHit.quality, dateHit.text) : null,
    transactionType: typeHit ? field(cleanName(typeHit.text), trust(typeHit.line), typeHit.quality, typeHit.text) : null,
    referenceNumber: referenceHit
      ? field(REFERENCE.exec(referenceHit.text.toUpperCase())?.[1] ?? referenceHit.text.trim(), trust(referenceHit.line), referenceHit.quality, referenceHit.text)
      : null,
    sender: senderHit ? field(cleanName(senderHit.text), trust(senderHit.line), senderHit.quality, senderHit.text) : null,
    currency: /₦|\bNGN\b|\bN\s*\d/i.test(text) ? "NGN" : null,
    bank: detectBank(text),
    raw: result,
  };
}

/** A name or a word, not a number and not a label. */
function isNameLike(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (looksLikeMoney(trimmed)) return false;
  if (/^\d+$/.test(trimmed.replace(/\s/g, ""))) return false;
  return /[a-z]{2,}/i.test(trimmed);
}

function cleanName(text: string): string {
  return text.replace(/^[^:]{1,40}:\s*/, "").replace(/\s+/g, " ").trim();
}

/**
 * Is this a receipt at all (Section 8)?
 *
 * Decided from the text, not from a model's self-report: a payment confirmation
 * carries transaction vocabulary and a currency amount. A selfie yields almost
 * no text; a random screenshot yields text with none of these markers.
 */
export function looksLikeReceipt(result: OcrResult): { isReceipt: boolean; reason: string } {
  const text = plainText(result).toLowerCase();

  if (result.lines.length < 3) {
    return { isReceipt: false, reason: "almost no text found" };
  }

  const markers = RECEIPT_MARKERS.filter((marker) => text.includes(marker));
  if (markers.length < 2) {
    return { isReceipt: false, reason: "no transaction vocabulary" };
  }

  if (!/₦|\bngn\b|\bn\s*\d|\d[,.]\d{2}\b|\d{1,3}(,\d{3})+/i.test(text)) {
    return { isReceipt: false, reason: "no currency amount" };
  }

  return { isReceipt: true, reason: `matched ${markers.slice(0, 4).join(", ")}` };
}
