import { ObjectId } from "mongodb";
import type {
  Category,
  CategoryTotal,
  DateRange,
  NewTransaction,
  SpendingSummary,
  Transaction,
  User,
} from "../core/types.js";
import { dayRange } from "../core/time.js";
import { transactions, users } from "./client.js";
import { toTransaction, toUser, type TransactionDoc, type UserDoc } from "./documents.js";

export { connectToDatabase, closeDatabase, ensureIndexes, describeDatabase } from "./client.js";

/**
 * The database layer. This module and its siblings are the only places in the
 * application that import the MongoDB driver or build a query — everything else
 * calls the functions below and receives plain domain objects.
 */

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/** Transactions that count: not rejected, not undone. */
const VALID_TRANSACTION = { status: { $ne: "rejected" as const }, undone_at: null };

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/** A user record is created on first contact. There is no signup and no auth. */
export async function getOrCreateUser(telegramUserId: number): Promise<User> {
  const result = await users().findOneAndUpdate(
    { telegram_user_id: telegramUserId },
    {
      $setOnInsert: {
        telegram_user_id: telegramUserId,
        created_at: new Date(),
        pending_category_transaction_id: null,
        merchant_categories: {},
      } satisfies UserDoc,
    },
    { upsert: true, returnDocument: "after" },
  );

  if (!result) {
    throw new Error(`Failed to create or load user ${telegramUserId}`);
  }
  return toUser(result);
}

/** Records that the bot is waiting on a category answer, or clears it with null. */
export async function setPendingCategoryTransaction(
  telegramUserId: number,
  transactionId: string | null,
): Promise<void> {
  const objectId = transactionId ? toObjectId(transactionId) : null;
  if (transactionId && !objectId) {
    throw new Error(`Invalid transaction id: ${transactionId}`);
  }
  await users().updateOne(
    { telegram_user_id: telegramUserId },
    { $set: { pending_category_transaction_id: objectId } },
  );
}

/**
 * The transaction this user still owes a category answer for, if any. Returns
 * null once it has been answered, undone, or rejected.
 */
export async function getPendingCategoryTransaction(telegramUserId: number): Promise<Transaction | null> {
  const user = await users().findOne({ telegram_user_id: telegramUserId });
  if (!user?.pending_category_transaction_id) return null;

  const doc = await transactions().findOne({
    _id: user.pending_category_transaction_id,
    telegram_user_id: telegramUserId,
    status: "needs_category",
    undone_at: null,
  });
  return doc ? toTransaction(doc) : null;
}

/** Section 6: remember this user's category choice so the merchant is auto-filed next time. */
export async function rememberMerchantCategory(
  telegramUserId: number,
  normalizedMerchant: string,
  category: Category,
): Promise<void> {
  if (!normalizedMerchant) return;
  await users().updateOne(
    { telegram_user_id: telegramUserId },
    { $set: { [`merchant_categories.${escapeMerchantKey(normalizedMerchant)}`]: category } },
  );
}

export async function getLearnedMerchantCategory(
  telegramUserId: number,
  normalizedMerchant: string,
): Promise<Category | null> {
  if (!normalizedMerchant) return null;
  const user = await users().findOne({ telegram_user_id: telegramUserId });
  return user?.merchant_categories?.[escapeMerchantKey(normalizedMerchant)] ?? null;
}

/** Mongo field names cannot contain "." or start with "$". */
function escapeMerchantKey(merchant: string): string {
  return merchant.replace(/\./g, "．").replace(/^\$/, "＄");
}

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

export async function saveTransaction(input: NewTransaction): Promise<Transaction> {
  const doc: TransactionDoc = {
    _id: new ObjectId(),
    telegram_user_id: input.telegramUserId,
    amount_kobo: input.amountKobo,
    merchant: input.merchant,
    normalized_merchant: input.normalizedMerchant,
    transaction_date: input.transactionDate,
    transaction_type: input.transactionType,
    reference_number: input.referenceNumber,
    category: input.category,
    status: input.status,
    source_receipt_hash: input.sourceReceiptHash,
    transport_ref: input.transportRef,
    bank: input.bank,
    raw_extraction_json: input.rawExtraction,
    created_at: new Date(),
    undone_at: null,
  };

  await transactions().insertOne(doc);
  return toTransaction(doc);
}

export async function findTransactionById(transactionId: string): Promise<Transaction | null> {
  const objectId = toObjectId(transactionId);
  if (!objectId) return null;
  const doc = await transactions().findOne({ _id: objectId });
  return doc ? toTransaction(doc) : null;
}

export async function updateTransactionCategory(
  transactionId: string,
  category: Category,
): Promise<Transaction | null> {
  const objectId = toObjectId(transactionId);
  if (!objectId) return null;

  const doc = await transactions().findOneAndUpdate(
    { _id: objectId },
    { $set: { category, status: "confirmed" as const } },
    { returnDocument: "after" },
  );
  return doc ? toTransaction(doc) : null;
}

// --- duplicate detection lookups (Section 7) -------------------------------

/** Fast first pass: the identical file bytes were already sent by this user. */
export async function findTransactionByReceiptHash(
  telegramUserId: number,
  sourceReceiptHash: string,
): Promise<Transaction | null> {
  const doc = await transactions().findOne({
    telegram_user_id: telegramUserId,
    source_receipt_hash: sourceReceiptHash,
    ...VALID_TRANSACTION,
  });
  return doc ? toTransaction(doc) : null;
}

/** A reference-number match within a user is a certain duplicate. */
export async function findTransactionByReference(
  telegramUserId: number,
  referenceNumber: string,
): Promise<Transaction | null> {
  if (!referenceNumber) return null;
  const doc = await transactions().findOne({
    telegram_user_id: telegramUserId,
    reference_number: referenceNumber,
    ...VALID_TRANSACTION,
  });
  return doc ? toTransaction(doc) : null;
}

/**
 * Fallback when the receipt carries no reference number: same amount, merchant
 * and calendar day for this user. A hit here is a *likely* duplicate, not a
 * certain one — two identical purchases on one day are possible.
 */
export async function findTransactionByAmountMerchantDate(
  telegramUserId: number,
  amountKobo: number,
  normalizedMerchant: string,
  transactionDate: Date,
): Promise<Transaction | null> {
  // The Nigerian calendar day, not the server's — see core/time.ts.
  const day = dayRange(transactionDate);

  const doc = await transactions().findOne({
    telegram_user_id: telegramUserId,
    amount_kobo: amountKobo,
    normalized_merchant: normalizedMerchant,
    transaction_date: { $gte: day.from, $lt: day.to },
    ...VALID_TRANSACTION,
  });
  return doc ? toTransaction(doc) : null;
}

// --- undo (Sections 3 and 9) -----------------------------------------------

/**
 * The most recent valid transaction for a user — what "undo the last one" means.
 * Ordered by when we logged it, not by the date printed on the receipt.
 */
export async function findRecentTransaction(telegramUserId: number): Promise<Transaction | null> {
  const doc = await transactions().findOne(
    { telegram_user_id: telegramUserId, ...VALID_TRANSACTION },
    { sort: { created_at: -1 } },
  );
  return doc ? toTransaction(doc) : null;
}

/**
 * Soft-delete: the row stops counting anywhere but stays available for
 * debugging, which matters while extraction is still being tuned.
 */
export async function markTransactionUndone(transactionId: string): Promise<Transaction | null> {
  const objectId = toObjectId(transactionId);
  if (!objectId) return null;

  const doc = await transactions().findOneAndUpdate(
    { _id: objectId, undone_at: null },
    { $set: { undone_at: new Date() } },
    { returnDocument: "after" },
  );
  return doc ? toTransaction(doc) : null;
}

// --- reads (Sections 9 and 10) ---------------------------------------------

/** Spending grouped by category over a date range, for one user. */
export async function getMonthlySummary(
  telegramUserId: number,
  range: DateRange,
): Promise<SpendingSummary> {
  const rows = await transactions()
    .aggregate<{ _id: Category | null; totalKobo: number; transactionCount: number }>([
      {
        $match: {
          telegram_user_id: telegramUserId,
          transaction_date: { $gte: range.from, $lt: range.to },
          amount_kobo: { $ne: null },
          ...VALID_TRANSACTION,
        },
      },
      {
        $group: {
          _id: "$category",
          totalKobo: { $sum: "$amount_kobo" },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { totalKobo: -1 } },
    ])
    .toArray();

  const byCategory: CategoryTotal[] = [];
  let totalKobo = 0;
  let transactionCount = 0;
  let pendingKobo = 0;
  let pendingCount = 0;

  for (const row of rows) {
    totalKobo += row.totalKobo;
    transactionCount += row.transactionCount;
    if (row._id === null) {
      pendingKobo += row.totalKobo;
      pendingCount += row.transactionCount;
    } else {
      byCategory.push({
        category: row._id,
        totalKobo: row.totalKobo,
        transactionCount: row.transactionCount,
      });
    }
  }

  return { from: range.from, to: range.to, byCategory, totalKobo, transactionCount, pendingKobo, pendingCount };
}

export async function listTransactions(
  telegramUserId: number,
  options: { limit?: number; includeInvalid?: boolean } = {},
): Promise<Transaction[]> {
  const { limit = 50, includeInvalid = false } = options;
  const docs = await transactions()
    .find(
      { telegram_user_id: telegramUserId, ...(includeInvalid ? {} : VALID_TRANSACTION) },
      { sort: { created_at: -1 }, limit },
    )
    .toArray();
  return docs.map(toTransaction);
}
