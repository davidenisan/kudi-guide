import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { assistantCategories, interpretMoneyMessage, interpretationSchema, type Interpretation } from "./moneyAssistant.js";
import { downloadTelegramReceipt, readReceipt, ReceiptError, type TelegramFile } from "./receiptReader.js";

const pendingSchema = z.object({ value: interpretationSchema, mode: z.enum(["create", "correct"]), targetId: z.string().nullable(), dedupHash: z.string(), receipt: z.boolean() });
const stateSchema = z.object({ pending: pendingSchema.nullable(), lastTransactionId: z.string().nullable(), history: z.array(z.object({ user: z.string(), reply: z.string() })) });
type State = z.infer<typeof stateSchema>;
const help = "Send an expense naturally: Spenk 4k on Suya, or send a receipt photo/PDF.\n\n/summary today — today's spending\n/summary week — last 7 days\n/summary month — this month\n/last — latest transaction\n/cancel — discard the pending draft\n\nReceipts and expenses save straight to your app. Try 'actually 5k' to update your last expense. JPEG, PNG, WebP and PDFs up to 10 MB / 5 pages are supported.";
const money = (amount: number, currency = "NGN") => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

function complete(value: Interpretation) { return value.amount !== null && Boolean(value.merchant?.trim()); }
export function periodStart(now: Date, period: "today" | "week" | "month") {
  const local = new Date(now.getTime() + 3600000);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), period === "month" ? 1 : local.getUTCDate());
  return new Date(day - 3600000 - (period === "week" ? 6 * 86400000 : 0));
}

export async function handleAssistantMessage(input: { userId: string; chatId: string; messageId?: number; text: string; receivedAt: Date; file?: TelegramFile }): Promise<string> {
  const key = createHash("sha256").update([input.userId, input.chatId, input.messageId ?? `${input.receivedAt.toISOString()}|${input.text}|${input.file?.file_unique_id ?? ""}`].join("|")).digest("hex");
  const existing = await prisma.telegramTurn.findUnique({ where: { key } });
  if (existing) return existing.reply;
  const saved = await prisma.telegramConversation.findUnique({ where: { userId: input.userId } });
  const fresh = saved && Date.now() - saved.updatedAt.getTime() < 30 * 60 * 1000;
  const parsedState = fresh ? stateSchema.safeParse(saved.state) : null;
  const state: State = parsedState?.success ? parsedState.data : { pending: null, lastTransactionId: null, history: [] };
  const last = state.lastTransactionId ? await prisma.transaction.findFirst({ where: { id: state.lastTransactionId, userId: input.userId }, include: { category: true } }) : null;
  let reply = "";
  let write: z.infer<typeof pendingSchema> | null = null;
  const command = input.text.trim().toLowerCase();
  const hasFile = Boolean(input.file);
  if (!hasFile && /^(?:\/cancel|cancel|never mind|nevermind)$/i.test(command)) {
    state.pending = null; reply = "Draft discarded. Your saved transactions haven't changed.";
  } else if (!hasFile && /^(?:\/confirm|confirm|yes|save it)$/i.test(command)) {
    if (!state.pending) reply = "There isn't a pending draft. Send an expense or receipt first.";
    else if (!complete(state.pending.value)) reply = "I still need the amount and merchant before I can save this expense.";
    else { write = state.pending; state.pending = null; }
  } else {
    let receiptText: string | undefined;
    if (input.file) {
      try { receiptText = (await readReceipt(await downloadTelegramReceipt(input.file))).text; }
      catch (error) { reply = error instanceof ReceiptError ? error.message : "I couldn't process that receipt. Please send it again."; }
    }
    if (!reply) {
      let value = await interpretMoneyMessage({ text: input.text || "Read this receipt", receiptText, now: input.receivedAt, context: { pending: hasFile ? null : state.pending?.value ?? null, last: !hasFile && last ? { amount: last.amount.toNumber(), currency: last.currency, merchant: last.merchant, category: last.category?.name ?? "Other" } : null, history: hasFile ? [] : state.history.slice(-4) } });
      // A document cannot authorize commands or mutate existing transactions, even if inference is compromised.
      if (hasFile && !["expense", "clarify"].includes(value.intent)) value = { ...value, intent: "clarify", amount: null, question: "Please send one readable expense receipt." };
      if (value.intent === "help") reply = help;
      else if (value.intent === "summary") {
        const rows = await prisma.transaction.findMany({ where: { userId: input.userId, occurredAt: { gte: periodStart(input.receivedAt, value.period), lte: input.receivedAt }, status: { not: "duplicate" } }, select: { amount: true, currency: true } });
        const totals = new Map<string, number>();
        for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount.toNumber());
        reply = rows.length ? `Spending ${value.period === "today" ? "today" : value.period === "week" ? "in the last 7 days" : "this month"}:\n${[...totals].map(([currency, amount]) => money(amount, currency)).join("\n")}\n${rows.length} transaction${rows.length === 1 ? "" : "s"}.` : "No tracked expenses in that period yet.";
      } else if (value.intent === "last") {
        const latest = await prisma.transaction.findFirst({ where: { userId: input.userId, status: { not: "duplicate" } }, orderBy: { occurredAt: "desc" }, include: { category: true } });
        if (latest) { state.lastTransactionId = latest.id; reply = `Latest expense: ${money(latest.amount.toNumber(), latest.currency)} · ${latest.merchant ?? "Unknown merchant"} · ${latest.category?.name ?? "Other"}.`; }
        else reply = "You haven't tracked an expense yet.";
      } else {
        const previous = hasFile ? null : state.pending;
        const correctingPending = value.intent === "correct" && Boolean(previous);
        const correctingSaved = value.intent === "correct" && !previous;
        if (correctingSaved && !last) reply = "Which expense should I correct? Use /last first, then tell me the change.";
        else {
          const draft = { value, mode: correctingSaved ? "correct" as const : correctingPending ? previous!.mode : "create" as const, targetId: correctingSaved ? last!.id : correctingPending ? previous!.targetId : null, dedupHash: previous && (correctingPending || !complete(previous.value)) ? previous.dedupHash : createHash("sha256").update(`${input.userId}|${input.file?.file_unique_id ?? key}`).digest("hex"), receipt: hasFile || Boolean(previous?.receipt && (correctingPending || !complete(previous.value))) };
          // Incomplete drafts retain their known facts for the next turn; an explicit new expense replaces them.
          if (value.intent === "clarify" && previous) draft.value = { ...previous.value, question: value.question };
          if (!complete(draft.value) || value.intent === "clarify") {
            state.pending = draft;
            reply = value.question || (draft.value.amount === null ? "How much did you spend?" : "What merchant or expense was that for?");
          } else { write = draft; state.pending = null; }
        }
      }
    }
  }
  // Changes, context and the replay response commit together. A retry never reapplies a correction or creates another expense.
  return prisma.$transaction(async (tx) => {
    const replay = await tx.telegramTurn.findUnique({ where: { key } });
    if (replay) return replay.reply;
    if (write) {
      const value = write.value;
      const categoryName = assistantCategories.includes(value.category as typeof assistantCategories[number]) ? value.category! : "Other";
      const category = await tx.category.upsert({ where: { name: categoryName }, create: { name: categoryName, isSystemDefault: true }, update: {} });
      const data = { amount: value.amount!, currency: value.currency ?? "NGN", merchant: value.merchant!.trim(), categoryId: category.id, occurredAt: value.date ? new Date(`${value.date}T12:00:00+01:00`) : input.receivedAt, confidenceScore: value.confidence, status: "confirmed" as const };
      let transaction;
      if (write.mode === "correct") {
        const target = await tx.transaction.findFirst({ where: { id: write.targetId!, userId: input.userId } });
        if (!target) reply = "That transaction is no longer available. Please use /last and try again.";
        else transaction = await tx.transaction.update({ where: { id: target.id, userId: input.userId }, data: { ...data, occurredAt: value.date ? data.occurredAt : target.occurredAt } });
      } else transaction = await tx.transaction.upsert({ where: { dedupHash: write.dedupHash }, update: {}, create: { ...data, userId: input.userId, source: "telegram", dedupHash: write.dedupHash } });
      if (transaction) { state.lastTransactionId = transaction.id; reply = `${write.mode === "correct" ? "Updated" : "Added"} ${money(transaction.amount.toNumber(), transaction.currency)} · ${transaction.merchant}. Category: ${categoryName}. Saved to your app. Tell me a correction anytime.`; }
    }
    state.history = [...state.history, { user: (input.file ? "[Receipt] " : "") + input.text.slice(0, 300), reply: reply.slice(0, 500) }].slice(-4);
    await tx.telegramConversation.upsert({ where: { userId: input.userId }, create: { userId: input.userId, state }, update: { state } });
    await tx.telegramTurn.create({ data: { key, userId: input.userId, reply } });
    return reply;
  });
}
