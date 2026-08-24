import { env, requireTelegramToken } from "./config/env.js";
import { router } from "./core/router.js";
import { disposeNlu, warmUpNlu } from "./core/nlu/index.js";
import { closeDatabase, connectToDatabase } from "./db/index.js";
import { logger } from "./logger.js";
import { createTelegramAdapter } from "./transport/telegram/adapter.js";

/**
 * Entrypoint. Note how little it knows: it wires one transport adapter to one
 * message handler. The adapter is the only Telegram-aware piece, and swapping it
 * is the whole migration path in Section 12.
 */
async function main(): Promise<void> {
  const token = requireTelegramToken();

  await connectToDatabase();
  logger.info("connected to mongodb", { database: env.MONGODB_DB_NAME });

  // Load the NLU model before serving, so the first real message isn't waiting
  // on it. If it fails the bot still runs — understanding falls back to the
  // deterministic matcher.
  if (env.NLU_ENABLED) {
    const ready = await warmUpNlu();
    if (!ready) logger.warn("running without the NLU model — pattern fallback only");
  } else {
    logger.info("NLU disabled by configuration — pattern fallback only");
  }

  const adapter = createTelegramAdapter(token, router);
  await adapter.start();

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    void adapter
      .stop()
      .catch((error: unknown) => logger.error("error stopping adapter", { error }))
      .finally(async () => {
        await disposeNlu();
        await closeDatabase();
        process.exit(0);
      });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error("failed to start", { error });
  process.exitCode = 1;
});
