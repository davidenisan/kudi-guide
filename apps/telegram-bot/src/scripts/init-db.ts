import { env } from "../config/env.js";
import { closeDatabase, connectToDatabase, describeDatabase } from "../db/index.js";

/**
 * Connects to MongoDB and creates the collections and indexes from Section 4.
 * Safe to re-run. The bot does this on startup too; this script exists so the
 * database can be set up and inspected on its own.
 */
async function main(): Promise<void> {
  console.log(`Connecting to ${env.MONGODB_URI} (db: ${env.MONGODB_DB_NAME})`);
  await connectToDatabase();

  const { database, collections } = await describeDatabase();
  console.log(`\nDatabase: ${database}`);
  for (const collection of collections) {
    console.log(`\n  ${collection.name} — ${collection.documentCount} document(s)`);
    for (const index of collection.indexes) {
      console.log(`    index: ${index}`);
    }
  }
  console.log("\nReady.");
}

main()
  .catch((error: unknown) => {
    console.error("Database setup failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
