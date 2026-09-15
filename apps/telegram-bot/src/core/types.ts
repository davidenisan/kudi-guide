/**
 * Domain types for the expense-tracking core.
 *
 * These are deliberately free of both transport (Telegram) and storage (MongoDB)
 * concerns — no `file_id`, no `ObjectId`. The db module maps between these and
 * the stored documents; the transport adapter maps between these and Telegram.
 */

/** The fixed category list from Section 6. Nothing outside this list is valid. */
export const CATEGORIES = [
  "Food",
  "Shopping",
  "Transport",
  "Data & Airtime",
  "Bills",
  "Family",
  "Savings & Investing",
  "Health",
  "Entertainment",
  "Others",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * `rejected` rows exist only for debugging visibility (Section 8) and must never
 * appear in a summary or be reachable by undo.
 */
export type TransactionStatus = "confirmed" | "needs_category" | "rejected";

export interface User {
  /** Telegram's numeric user ID — the primary identifier for Phase 0. */
  telegramUserId: number;
  createdAt: Date;
  /** Set while the bot is waiting for this user to answer a category question. */
  pendingCategoryTransactionId: string | null;
  /** Per-user learned merchant -> category choices (Section 6), keyed by normalized merchant. */
  merchantCategories: Record<string, Category>;
}

export interface Transaction {
  id: string;
  telegramUserId: number;
  /** Integer kobo. Never a float naira value. Null only on rejected/unparsed rows. */
  amountKobo: number | null;
  /** Raw extracted merchant string, as it appeared on the receipt. */
  merchant: string | null;
  /** Merchant normalized for matching and for the dedup fingerprint. */
  normalizedMerchant: string | null;
  transactionDate: Date | null;
  transactionType: string | null;
  referenceNumber: string | null;
  category: Category | null;
  status: TransactionStatus;
  /** SHA-256 of the raw uploaded file bytes (Section 7 fast-path dedup). */
  sourceReceiptHash: string;
  /**
   * Opaque handle for re-fetching the original image from the transport that
   * received it. Stored instead of a second copy of the file. Never parsed here,
   * and never guaranteed to still resolve.
   */
  transportRef: string | null;
  /** Which bank the receipt looked like, for per-bank accuracy reporting. */
  bank: string | null;
  /** Full extraction output, always stored — this is the debugging record. */
  rawExtraction: unknown;
  createdAt: Date;
  /** Set when the user undoes the entry; undone rows are excluded everywhere. */
  undoneAt: Date | null;
}

/** What the pipeline hands to the db layer to create a transaction. */
export type NewTransaction = Omit<Transaction, "id" | "createdAt" | "undoneAt">;

export interface CategoryTotal {
  category: Category;
  totalKobo: number;
  transactionCount: number;
}

export interface SpendingSummary {
  from: Date;
  to: Date;
  byCategory: CategoryTotal[];
  /** Totals across every counted transaction, including the still-uncategorized ones. */
  totalKobo: number;
  transactionCount: number;
  /**
   * Spend on transactions still awaiting a category answer. Kept out of
   * byCategory so nothing is filed under a category the user never chose.
   */
  pendingKobo: number;
  pendingCount: number;
}

export interface DateRange {
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
}
