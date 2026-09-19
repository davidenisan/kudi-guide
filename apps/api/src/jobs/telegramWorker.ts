import { Queue, Worker } from "bullmq";
import { redisConnection } from "./queues.js";
import { processTelegramUpdate, sendTelegramMessage, type TelegramUpdate } from "../routes/telegram.js";

const telegramQueue = new Queue<TelegramUpdate>("telegram-ingestion", { connection: redisConnection });
export async function enqueueTelegramUpdate(update: TelegramUpdate) {
  if (!Number.isSafeInteger(update.update_id)) return;
  await telegramQueue.add("message", update, { jobId: `update-${update.update_id}`, attempts: 1, removeOnComplete: { age: 86400, count: 1000 }, removeOnFail: { age: 7 * 86400, count: 500 } });
}
export function startTelegramWorker() {
  // A single ordered worker keeps follow-up messages after their original expense.
  // Polling stays responsive while OCR and inference run; queued work survives API restarts.
  const worker = new Worker<TelegramUpdate>("telegram-ingestion", async (job) => {
    await processTelegramUpdate(job.data);
  }, { connection: redisConnection, concurrency: 1 });
  worker.on("failed", (job) => {
    console.error("[telegram] message processing failed", { jobId: job?.id });
    const message = job?.data.message;
    if (message?.chat?.type === "private" && message.chat.id !== undefined) {
      void sendTelegramMessage(String(message.chat.id), "I couldn't finish processing that message. Please resend it. If you already see the transaction on your dashboard, it has been saved.").catch(() => {});
    }
  });
  return worker;
}
