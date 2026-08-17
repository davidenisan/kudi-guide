import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "../config/env.js";

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (error) => {
  console.error("[redis] connection error", error.message);
});

export const ocrProcessingQueue = new Queue("ocr-processing", {
  connection: redisConnection,
});
