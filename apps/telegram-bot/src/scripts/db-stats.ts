import { closeDatabase, connectToDatabase, listTransactions, describeDatabase } from "../db/index.js";

/**
 * Read-only look at what is in the database. `npm run db:stats -- <telegramUserId>`
 * additionally prints that user's recent transactions.
 */
async function main(): Promise<void> {
  await connectToDatabase();

  const { database, collections } = await describeDatabase();
  console.log(`Database: ${database}`);
  for (const collection of collections) {
    console.log(`  ${collection.name}: ${collection.documentCount} document(s)`);
  }

  const userArg = process.argv[2];
  if (!userArg) return;

  const telegramUserId = Number(userArg);
  if (!Number.isInteger(telegramUserId)) {
    console.error(`\nNot a Telegram user id: ${userArg}`);
    process.exitCode = 1;
    return;
  }

  const recent = await listTransactions(telegramUserId, { limit: 20, includeInvalid: true });
  console.log(`\nRecent transactions for ${telegramUserId}: ${recent.length}`);
  for (const transaction of recent) {
    const naira = transaction.amountKobo === null ? "—" : (transaction.amountKobo / 100).toFixed(2);
    console.log(
      `  ${transaction.createdAt.toISOString()}  ₦${naira}  ${transaction.merchant ?? "—"}  ` +
        `[${transaction.status}${transaction.undoneAt ? ", undone" : ""}]  ${transaction.category ?? "uncategorized"}`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("Failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
