import type { ObjectId } from "mongodb";
import type { Category, Transaction, TransactionStatus, User } from "../core/types.js";

/**
 * Stored document shapes. Field names here follow the spec's snake_case data
 * model (Section 4); the camelCase domain types in core/types.ts are what the
 * rest of the app sees. These two shapes are mapped at this boundary and
 * nowhere else.
 */

export interface UserDoc {
  _id?: ObjectId;
  telegram_user_id: number;
  created_at: Date;
  pending_category_transaction_id: ObjectId | null;
  merchant_categories: Record<string, Category>;
}

export interface TransactionDoc {
  _id: ObjectId;
  telegram_user_id: number;
  amount_kobo: number | null;
  merchant: string | null;
  normalized_merchant: string | null;
  transaction_date: Date | null;
  transaction_type: string | null;
  reference_number: string | null;
  category: Category | null;
  status: TransactionStatus;
  source_receipt_hash: string;
  transport_ref: string | null;
  bank: string | null;
  raw_extraction_json: unknown;
  created_at: Date;
  undone_at: Date | null;
}

export function toUser(doc: UserDoc): User {
  return {
    telegramUserId: doc.telegram_user_id,
    createdAt: doc.created_at,
    pendingCategoryTransactionId: doc.pending_category_transaction_id
      ? doc.pending_category_transaction_id.toHexString()
      : null,
    merchantCategories: doc.merchant_categories ?? {},
  };
}

export function toTransaction(doc: TransactionDoc): Transaction {
  return {
    id: doc._id.toHexString(),
    telegramUserId: doc.telegram_user_id,
    amountKobo: doc.amount_kobo,
    merchant: doc.merchant,
    normalizedMerchant: doc.normalized_merchant,
    transactionDate: doc.transaction_date,
    transactionType: doc.transaction_type,
    referenceNumber: doc.reference_number,
    category: doc.category,
    status: doc.status,
    sourceReceiptHash: doc.source_receipt_hash,
    transportRef: doc.transport_ref ?? null,
    bank: doc.bank ?? null,
    rawExtraction: doc.raw_extraction_json,
    createdAt: doc.created_at,
    undoneAt: doc.undone_at,
  };
}
