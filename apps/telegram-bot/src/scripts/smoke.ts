import { MongoClient } from "mongodb";
import { env } from "../config/env.js";
import { monthRange } from "../core/time.js";
import {
  closeDatabase,
  connectToDatabase,
  findRecentTransaction,
  findTransactionByAmountMerchantDate,
  findTransactionByReceiptHash,
  findTransactionByReference,
  getLearnedMerchantCategory,
  getMonthlySummary,
  getOrCreateUser,
  getPendingCategoryTransaction,
  markTransactionUndone,
  rememberMerchantCategory,
  saveTransaction,
  setPendingCategoryTransaction,
  updateTransactionCategory,
} from "../db/index.js";

const USER = 999000111;
let failures = 0;

function check(label: string, condition: boolean): void {
  console.log(`${condition ? "  ok  " : "  FAIL"} ${label}`);
  if (!condition) failures += 1;
}

async function main(): Promise<void> {
  await connectToDatabase();

  const user = await getOrCreateUser(USER);
  check("creates user on first contact", user.telegramUserId === USER);
  const again = await getOrCreateUser(USER);
  check("is idempotent", again.createdAt.getTime() === user.createdAt.getTime());

  const date = new Date("2026-08-10T12:00:00Z");
  const tx = await saveTransaction({
    telegramUserId: USER,
    amountKobo: 1_250_000,
    merchant: "Jumia",
    normalizedMerchant: "jumia",
    transactionDate: date,
    transactionType: "payment",
    referenceNumber: "REF123",
    category: "Shopping",
    status: "confirmed",
    sourceReceiptHash: "hash-a",
    transportRef: "telegram-file-a",
    bank: "GTBank",
    rawExtraction: { lines: ["Amount", "N12,500.00"] },
  });
  check("saves integer kobo", tx.amountKobo === 1_250_000);
  check("returns a string id, not an ObjectId", typeof tx.id === "string");
  check("stores raw extraction", JSON.stringify(tx.rawExtraction).includes("12,500"));

  check("dedup by file hash", (await findTransactionByReceiptHash(USER, "hash-a"))?.id === tx.id);
  check("dedup by reference", (await findTransactionByReference(USER, "REF123"))?.id === tx.id);
  check(
    "dedup by amount+merchant+day",
    // 22:00Z is still 23:00 the same day in Lagos.
    (await findTransactionByAmountMerchantDate(USER, 1_250_000, "jumia", new Date("2026-08-10T22:00:00Z")))?.id ===
      tx.id,
  );
  check(
    "day boundary follows Lagos, not UTC",
    // 23:30Z is already 00:30 the next day in Lagos, so this is a new day.
    (await findTransactionByAmountMerchantDate(USER, 1_250_000, "jumia", new Date("2026-08-10T23:30:00Z"))) === null,
  );
  check(
    "different day is not a duplicate",
    (await findTransactionByAmountMerchantDate(USER, 1_250_000, "jumia", new Date("2026-08-11T12:00:00Z"))) === null,
  );
  check(
    "different merchant is not a duplicate",
    (await findTransactionByAmountMerchantDate(USER, 1_250_000, "shoprite", date)) === null,
  );
  check("another user's receipt is invisible", (await findTransactionByReference(USER + 1, "REF123")) === null);

  const pending = await saveTransaction({
    telegramUserId: USER,
    amountKobo: 300_000,
    merchant: "Mama Put",
    normalizedMerchant: "mama put",
    transactionDate: date,
    transactionType: "transfer",
    referenceNumber: null,
    category: null,
    status: "needs_category",
    sourceReceiptHash: "hash-b",
    transportRef: null,
    bank: "Kuda",
    rawExtraction: {},
  });
  await setPendingCategoryTransaction(USER, pending.id);
  check("tracks the pending category question", (await getPendingCategoryTransaction(USER))?.id === pending.id);

  await saveTransaction({
    telegramUserId: USER,
    amountKobo: 500_000,
    merchant: "Junk",
    normalizedMerchant: "junk",
    transactionDate: date,
    transactionType: null,
    referenceNumber: null,
    category: null,
    status: "rejected",
    sourceReceiptHash: "hash-c",
    transportRef: null,
    bank: null,
    rawExtraction: {},
  });

  const range = monthRange(date);
  check(
    "month range starts at Lagos midnight on the 1st",
    range.from.toISOString() === "2026-07-31T23:00:00.000Z" && range.to.toISOString() === "2026-08-31T23:00:00.000Z",
  );
  const summary = await getMonthlySummary(USER, range);
  check("summary excludes rejected rows", summary.totalKobo === 1_550_000);
  check("summary groups by category", summary.byCategory[0]?.category === "Shopping");
  check("uncategorized spend is kept separate", summary.pendingKobo === 300_000 && summary.pendingCount === 1);

  check("undo targets the most recent valid row", (await findRecentTransaction(USER))?.id === pending.id);
  await updateTransactionCategory(pending.id, "Food");
  await setPendingCategoryTransaction(USER, null);
  check("category answer clears the pending question", (await getPendingCategoryTransaction(USER)) === null);
  const afterAnswer = await getMonthlySummary(USER, range);
  check(
    "answered category moves into its bucket",
    afterAnswer.pendingCount === 0 && afterAnswer.byCategory.some((row) => row.category === "Food"),
  );

  await rememberMerchantCategory(USER, "mama put", "Food");
  check("learns merchant per user", (await getLearnedMerchantCategory(USER, "mama put")) === "Food");
  check("learning does not leak across users", (await getLearnedMerchantCategory(USER + 1, "mama put")) === null);
  await rememberMerchantCategory(USER, "shoprite ltd. lekki", "Shopping");
  check(
    "merchant keys with dots are safe",
    (await getLearnedMerchantCategory(USER, "shoprite ltd. lekki")) === "Shopping",
  );

  await markTransactionUndone(pending.id);
  const afterUndo = await getMonthlySummary(USER, range);
  check("undone rows stop counting", afterUndo.totalKobo === 1_250_000);
  check("undo falls through to the next valid row", (await findRecentTransaction(USER))?.id === tx.id);
  check("undone rows are not re-undoable", (await markTransactionUndone(pending.id)) === null);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    // Clean up the scratch user directly — the db layer has no delete-user op.
    const client = new MongoClient(env.MONGODB_URI);
    await client.connect();
    const db = client.db(env.MONGODB_DB_NAME);
    await db.collection("transactions").deleteMany({ telegram_user_id: USER });
    await db.collection("users").deleteMany({ telegram_user_id: USER });
    await client.close();
  });
