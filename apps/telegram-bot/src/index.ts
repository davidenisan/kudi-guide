import { env, requireTelegramToken } from "./config/env.js";
import { router } from "./core/router.js";
import { disposeNlu, warmUpNlu } from "./core/nlu/index.js";
import { ensureOcrService, stopOcrService } from "./ocr-supervisor.js";
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

  // Started here rather than left for someone to remember in a second terminal
  // — a receipt sent while nobody did that is exactly the failure this exists
  // to prevent. Never blocks startup on failure: a missing OCR service means
  // receipts fail until it's sorted, not that the rest of the bot should be
  // unreachable too.
  await ensureOcrService();

  const adapter = createTelegramAdapter(token, router);
  await adapter.start();

  const shutdown = (signal: string): void => {
    logger.info("shutting down", { signal });
    void adapter
      .stop()
      .catch((error: unknown) => logger.error("error stopping adapter", { error }))
      .finally(async () => {
        stopOcrService();
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
