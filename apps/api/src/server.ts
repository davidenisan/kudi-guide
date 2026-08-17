import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startOcrWorker } from "./jobs/ocrWorker.js";

const app = createApp();
const worker = startOcrWorker();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
