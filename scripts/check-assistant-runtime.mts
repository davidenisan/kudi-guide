import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { Queue } = createRequire(import.meta.url)("../apps/api/node_modules/bullmq");
import { redisConnection } from "../apps/api/src/jobs/queues.js";
import { assistantStatus } from "../apps/api/src/services/moneyAssistant.js";
const queue = new Queue("telegram-ingestion", { connection: redisConnection });
try {
 const ai = await assistantStatus(); const workers = await queue.getWorkers(); const jobs = await queue.getJobCounts("waiting", "active", "failed");
 assert.equal(ai.available, true); assert.ok(workers.length > 0, "Telegram worker must be running");
 console.log(JSON.stringify({ localModel: ai.model, modelAvailable: ai.available, telegramWorkers: workers.length, jobs }));
} finally { await queue.close(); await redisConnection.quit(); }
