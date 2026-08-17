import { Worker } from "bullmq";

import { redisConnection } from "./queues.js";

export function startOcrWorker() {
  const worker = new Worker(
    "ocr-processing",
    async (job) => {
      console.log("[ocr-processing] received job", {
        id: job.id,
        payload: job.data,
      });
    },
    { connection: redisConnection },
  );

  worker.on("failed", (job, error) => {
    console.error("[ocr-processing] job failed", {
      id: job?.id,
      error,
    });
  });

  return worker;
}
