import { createHash } from "node:crypto";

export type ParsedTransaction = {
  amount: number;
  currency: string;
  merchant: string | null;
  occurredAt: Date;
  confidenceScore: number;
  dedupHash: string;
};

const amountPattern =
  /(?:NGN|NGN\.|₦|N)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:NGN|naira)/i;

const merchantPatterns = [
  /\b(?:at|from|to|for|on|merchant)\s+([A-Z0-9][A-Z0-9 .&'/-]{2,60}?)(?:\s+(?:on|at|ref|reference|bal|balance|via)\b|[.;,\n]|$)/i,
  /\b(?:pos|web|transfer)\s+(?:purchase|payment)?\s*[-:]\s*([A-Z0-9][A-Z0-9 .&'/-]{2,60}?)(?:\s+(?:on|at|ref|reference|bal|balance)\b|[.;,\n]|$)/i,
];

const datePatterns = [
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  /\b(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
];

export function parseTransactionMessage(input: {
  text: string;
  receivedAt?: Date;
  chatId: string;
}): ParsedTransaction | null {
  const receivedAt = input.receivedAt ?? new Date();
  const normalizedText = input.text.replace(/\b(\d+(?:\.\d+)?)\s*([km])\b/gi, (_, value: string, suffix: string) => `₦${Number(value) * (suffix.toLowerCase() === "k" ? 1000 : 1000000)}`).replace(/\s+/g, " ").trim();
  if (/\?|\b(?:credit alert|received|refund|income)\b|^(?:actually|change|correct|what|how|show|delete|remove|undo|don't|do not)\b/i.test(normalizedText)) return null;
  const amountMatch = normalizedText.match(amountPattern);

  if (!amountMatch) {
    return null;
  }

  const amountValue = Number((amountMatch[1] ?? amountMatch[2]).replace(/,/g, ""));

  if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > 999999999999.99) {
    return null;
  }

  const merchant = extractMerchant(normalizedText);
  const occurredAt = extractDate(normalizedText, receivedAt);
  const confidenceScore = merchant ? 0.82 : 0.64;
  const dedupHash = createHash("sha256")
    .update([input.chatId, amountValue.toFixed(2), occurredAt.toISOString(), merchant, normalizedText].join("|"))
    .digest("hex");

  return {
    amount: amountValue,
    currency: "NGN",
    merchant,
    occurredAt,
    confidenceScore,
    dedupHash,
  };
}

function extractMerchant(text: string) {
  for (const pattern of merchantPatterns) {
    const match = text.match(pattern);
    const merchant = match?.[1]?.trim().replace(/\s+/g, " ");

    if (merchant) {
      return titleCase(merchant);
    }
  }

  return null;
}

function extractDate(text: string, fallback: Date) {
  const localDateMatch = text.match(datePatterns[0]);

  if (localDateMatch) {
    const [, day, month, year, hour = "12", minute = "0", second = "0"] = localDateMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const date = new Date(
      Number(fullYear),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );

    if (!Number.isNaN(date.valueOf())) {
      return date;
    }
  }

  const isoDateMatch = text.match(datePatterns[1]);

  if (isoDateMatch) {
    const [, year, month, day, hour = "12", minute = "0", second = "0"] = isoDateMatch;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );

    if (!Number.isNaN(date.valueOf())) {
      return date;
    }
  }

  return fallback;
}

function titleCase(input: string) {
  return input
    .toLowerCase()
    .split(" ")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}
