import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startTelegramWorker } from "./jobs/telegramWorker.js";

import { startTelegramConnection } from "./routes/telegram.js";

const stopTelegram = startTelegramConnection();
const app = createApp();
const worker = startTelegramWorker();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, shutting down`);
  stopTelegram();
  server.close();
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
