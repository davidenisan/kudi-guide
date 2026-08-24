import { MongoClient, type Collection, type Db } from "mongodb";
import { env } from "../config/env.js";
import type { TransactionDoc, UserDoc } from "./documents.js";

/**
 * Connection lifecycle and index setup. Internal to the db module — the rest of
 * the application talks to the service functions exported from ./index.ts and
 * never touches a driver object.
 */

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<void> {
  if (client) return;

  const nextClient = new MongoClient(env.MONGODB_URI);
  await nextClient.connect();
  client = nextClient;
  db = nextClient.db(env.MONGODB_DB_NAME);
  await ensureIndexes();
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
}

function requireDb(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectToDatabase() first.");
  }
  return db;
}

export function users(): Collection<UserDoc> {
  return requireDb().collection<UserDoc>("users");
}

export function transactions(): Collection<TransactionDoc> {
  return requireDb().collection<TransactionDoc>("transactions");
}

/**
 * Indexes from Section 4. Safe to run on every start — createIndex is a no-op
 * when the index already exists with the same definition.
 */
export async function ensureIndexes(): Promise<void> {
  await users().createIndex({ telegram_user_id: 1 }, { unique: true, name: "users_telegram_user_id_unique" });

  await transactions().createIndexes([
    // Every query filters on the owner.
    { key: { telegram_user_id: 1 }, name: "tx_telegram_user_id" },
    // Dedup lookups by reference number (Section 7). Sparse: many receipts have none.
    { key: { reference_number: 1 }, name: "tx_reference_number", sparse: true },
    // Fast first-pass dedup on the raw file hash (Section 7).
    { key: { source_receipt_hash: 1 }, name: "tx_source_receipt_hash" },
    // Monthly summaries.
    { key: { transaction_date: -1 }, name: "tx_transaction_date" },
    // Summary and undo both read "this user, most recent first".
    { key: { telegram_user_id: 1, transaction_date: -1 }, name: "tx_user_date" },
    // Undo actually orders by insertion time, not the date printed on the receipt.
    { key: { telegram_user_id: 1, created_at: -1 }, name: "tx_user_created" },
  ]);
}

/** Diagnostics only — used by the db:stats script. */
export async function describeDatabase(): Promise<{
  database: string;
  collections: { name: string; documentCount: number; indexes: string[] }[];
}> {
  const database = requireDb();
  const names = ["users", "transactions"] as const;
  const collections = await Promise.all(
    names.map(async (name) => {
      const collection = database.collection(name);
      const indexes = await collection.indexes();
      return {
        name,
        documentCount: await collection.countDocuments(),
        indexes: indexes.map((index) => index.name ?? "(unnamed)"),
      };
    }),
  );
  return { database: database.databaseName, collections };
}
