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
  // "transaction" alone is not a type label: it matches the "Transaction
  // Successful" banner that sits at the top of most receipts, and then anchors
  // to whatever name follows it. Kuda returned its merchant as the type that way.
  type: [
    "transaction type",
    "type",
    "payment type",
    "channel",
    "category",
    "narration",
    "description",
    "purpose",
  ],
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

/**
 * How near a candidate is to its label, in reading order.
 *
 * Two arrangements have to be told apart, because banks use both. Some stack the
 * value under the label; others put label and value side by side across the
 * width of the screen. A single distance formula cannot serve both: weighting
 * vertical distance heavily made a two-column receipt pick the label of the row
 * *below* over the value sitting right beside it, which is how "Narration" came
 * back as a merchant name.
 *
 * So same-row is recognised as its own case and always wins when it exists. A
 * value beside its label is unambiguous; a value below it is a guess about
 * layout, and only reasonable when nothing sits beside it.
 */
function proximity(label: OcrLine, candidate: OcrLine): number {
  const a = label.box;
  const b = candidate.box;
  if (!a || !b) return Number.POSITIVE_INFINITY;

  const labelMiddle = (a.top + a.bottom) / 2;
  const candidateMiddle = (b.top + b.bottom) / 2;
  const lineHeight = Math.max(a.bottom - a.top, 8);

  // Side by side: vertical centres within a line of each other.
  if (Math.abs(candidateMiddle - labelMiddle) <= lineHeight * 0.7) {
    // Must actually be to the right. A box overlapping the label horizontally is
    // the label itself, or a neighbouring column that reads before it.
    if (b.left < a.right - 2) return Number.POSITIVE_INFINITY;
    return (b.left - a.right) * 0.05;
  }

  // Above the label: wrong direction for every layout we care about.
  if (candidateMiddle < labelMiddle) return Number.POSITIVE_INFINITY;

  // Beneath: nearer is better, and directly beneath beats offset to one side.
  // Offset well past any same-row match so the two cases never compete.
  return 1000 + (candidateMiddle - labelMiddle) * 1.5 + Math.abs(centreX(b) - centreX(a)) * 0.8;
}

function centreX(box: { left: number; right: number }): number {
  return (box.left + box.right) / 2;
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

/**
 * Every label word, from every field. A line that is exactly one of these is a
 * label, not a value — without this, a two-column receipt happily returned
 * "Narration" as the merchant and "Status" as the reference number.
 */
const ALL_LABELS: ReadonlySet<string> = new Set([
  ...Object.values(LABELS).flat(),
  // Labels for fields we do not extract. They still have to be recognised as
  // labels, or they get offered up as values for the field above them — an
  // empty "Remark" row was returned as a merchant name.
  "remark",
  "remarks",
  "status",
  "transaction status",
  "balance",
  "account number",
  "account name",
  "bank",
  "bank name",
  "fee",
  "charge",
  "commission",
  "vat",
  "teller",
  "branch",
]);

function isLabelLine(line: OcrLine): boolean {
  return ALL_LABELS.has(normalizeLabel(line.text));
}

interface LabelHit {
  line: OcrLine;
  index: number;
  /** How exact the match was — an exact label beats one embedded in a sentence. */
  quality: number;
  /** Where in the vocabulary it matched. Earlier entries are more specific. */
  rank: number;
}

function findLabels(lines: OcrLine[], vocabulary: readonly string[]): LabelHit[] {
  const hits: LabelHit[] = [];

  lines.forEach((line, index) => {
    const normalized = normalizeLabel(line.text);
    if (normalized === "") return;

    // Exact matches are settled across the whole vocabulary before any partial
    // match is considered. Scanning entry by entry let a loose early entry claim
    // a line that a later entry named exactly: "reference" matched the tail of
    // "Transaction Reference" and scored it 0.85, while "Session Id" matched
    // exactly at 1.0 and outranked it — so the session id was returned as the
    // transaction's reference number.
    const exact = vocabulary.indexOf(normalized);
    if (exact !== -1) {
      hits.push({ line, index, quality: 1, rank: exact });
      return;
    }

    for (let rank = 0; rank < vocabulary.length; rank += 1) {
      const label = vocabulary[rank];
      if (normalized.startsWith(`${label} `) || normalized.endsWith(` ${label}`)) {
        hits.push({ line, index, quality: 0.85, rank });
        return;
      }
    }

    for (let rank = 0; rank < vocabulary.length; rank += 1) {
      const label = vocabulary[rank];
      if (normalized.includes(label) && normalized.length <= label.length + 12) {
        hits.push({ line, index, quality: 0.7, rank });
        return;
      }
    }
  });

  // Equally exact labels are ranked by how specific they are, which is the order
  // they are listed in: a receipt carrying both "Transaction Reference" and
  // "Session Id" should answer with the former.
  return hits.sort((a, b) => b.quality - a.quality || a.rank - b.rank || a.index - b.index);
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

    // A value block beside the label. Multi-line values are common — a
    // beneficiary is often name, account number, then bank — and the label is
    // centred against the whole block, so the line that matters can sit a row
    // above the label's own centre. Taking the topmost accepted line in the
    // block picks the name rather than the bank underneath it.
    const beside = valueColumn(lines, hit.line, accept);
    if (beside) {
      return { line: beside, text: beside.text, quality: hit.quality };
    }

    const candidates = lines
      .filter((line) => line !== hit.line && !isLabelLine(line) && accept(line.text))
      .map((line) => ({ line, distance: proximity(hit.line, line) }))
      .filter((entry) => Number.isFinite(entry.distance))
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length > 0) {
      return { line: candidates[0].line, text: candidates[0].line.text, quality: hit.quality };
    }
  }
  return null;
}

/**
 * Lines sitting to the right of a label, within a couple of rows of it.
 *
 * This is the two-column arrangement, and it has to be settled before falling
 * back to "nearest line below". Below-ness alone put the *next label* ahead of
 * the real value on an Access receipt: "Remark" shares the label column, so it
 * scored closer than the beneficiary name sitting to the right, and came back
 * as the merchant.
 */
function valueColumn(
  lines: OcrLine[],
  label: OcrLine,
  accept: (text: string) => boolean,
): OcrLine | null {
  const a = label.box;
  if (!a) return null;

  const labelMiddle = (a.top + a.bottom) / 2;
  const lineHeight = Math.max(a.bottom - a.top, 8);
  // Wide enough for a three-line block whose label is centred against it,
  // narrow enough that the neighbouring row does not reach in.
  const band = lineHeight * 2.5;

  return (
    lines
      .filter((line) => {
        if (line === label || !line.box || isLabelLine(line)) return false;
        if (line.box.left < a.right - 2) return false;
        return Math.abs((line.box.top + line.box.bottom) / 2 - labelMiddle) <= band;
      })
      .filter((line) => accept(line.text))
      .sort((x, y) => (x.box!.top - y.box!.top))[0] ?? null
  );
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

/**
 * Hyphens and slashes are part of the reference, not a boundary in it:
 * "KUDA-TRX-88213094" was being truncated to "88213094" by a stricter pattern.
 *
 * Long, too: a NIP reference runs to 33 characters
 * ("NXG000014260818141149252148982360"), and a 32-character cap rejected it,
 * which quietly demoted the receipt to whatever shorter number sat nearby — the
 * session id, a different field entirely.
 */
const REFERENCE = /\b([A-Z0-9][A-Z0-9\-_/]{4,44}[A-Z0-9])\b/;

function looksLikeReference(text: string): boolean {
  const candidate = text.trim().toUpperCase();
  if (!REFERENCE.test(candidate)) return false;
  // A plain number with grouping is money; a bare short number is not a ref.
  if (/^\d{1,3}([,\s]\d{3})+/.test(candidate)) return false;
  // Every real reference carries digits. Without this, any long uppercase word
  // qualifies, and "SUCCESSFUL" and "STATUS" both did.
  return /\d/.test(candidate);
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

  // 2026-08-18, ISO. Checked before the day-first pattern, which would read
  // the leading year as a day and give up.
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(cleaned);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
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

/**
 * The amount when nothing is labelled "Amount".
 *
 * Some apps don't label it at all — Kuda shows the figure alone and large near
 * the top, and the label-anchored pass finds nothing, which left the one field
 * the spec says to be most careful about empty.
 *
 * These layouts all lean on the same visual convention: the amount is the
 * biggest thing on the screen. So the fallback takes the money-shaped line with
 * the tallest text, and only when it is meaningfully taller than the body text —
 * a receipt where everything is the same size gives no signal, and guessing
 * there would be worse than asking.
 *
 * Reported at reduced confidence, because this is a reading of the layout rather
 * than of a label. Downstream that is the difference between logging it and
 * checking first.
 */
function prominentAmount(lines: OcrLine[]): { line: OcrLine; text: string; quality: number } | null {
  const withHeight = lines
    .filter((line) => line.box && looksLikeMoney(line.text))
    .map((line) => ({ line, height: line.box!.bottom - line.box!.top }));

  if (withHeight.length === 0) return null;

  const heights = lines.filter((line) => line.box).map((line) => line.box!.bottom - line.box!.top);
  const median = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)] ?? 0;

  const tallest = withHeight.sort((a, b) => b.height - a.height)[0];
  if (tallest.height < median * 1.25) return null;

  return { line: tallest.line, text: tallest.line.text, quality: 0.6 };
}

export function extractFields(result: OcrResult): ExtractedReceipt {
  const lines = result.lines;
  const text = plainText(result);

  // A PDF's own text layer is exact; OCR confidence is only meaningful for pixels.
  const trust = (line: OcrLine): number => (result.source === "pdf-text-layer" ? 1 : line.confidence);

  const amountHit =
    valueFor(lines, findLabels(lines, LABELS.amount), looksLikeMoney) ?? prominentAmount(lines);
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
  return text
    .replace(/^[^:]{1,40}:\s*/, "")
    .replace(/\s+/g, " ")
    // Receipts often print a name with a trailing separator before the account
    // number on the next line: "DGMC SOLUTIONS LTD -".
    .replace(/[\s\-–—:,;|]+$/, "")
    .trim();
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
