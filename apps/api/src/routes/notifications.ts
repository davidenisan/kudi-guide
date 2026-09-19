import { Router } from "express";
import { z } from "zod";
import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthDependencies } from "../auth/dependencies.js";
import { prisma } from "../db/prisma.js";
export function createNotificationsRouter(dependencies: AuthDependencies) {
 const router = Router(); router.use(createAuthMiddleware(dependencies));
 router.get("/", async (request, response) => {
  const userId = request.user!.id;
  const transactions = await prisma.transaction.findMany({ where: { userId, status: { not: "duplicate" } }, orderBy: { occurredAt: "desc" }, take: 50 });
  const read = await prisma.notification.findMany({ where: { userId, id: { in: transactions.map(t => t.id) }, readAt: { not: null } }, select: { id: true } });
  const ids = new Set(read.map(n => n.id));
  response.json({ notifications: transactions.map(t => ({ id: t.id, title: t.status === "needs_review" ? "Expense ready to review" : "Expense tracked", merchant: t.merchant ?? "Unknown merchant", amount: t.amount.toNumber(), currency: t.currency, date: t.occurredAt.toISOString(), read: ids.has(t.id) })) });
 });
 router.patch("/", async (request, response) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Choose valid notifications." }); return; }
  const owned = await prisma.transaction.findMany({ where: { id: { in: parsed.data.ids }, userId: request.user!.id }, select: { id: true } });
  if (new Set(parsed.data.ids).size !== owned.length) { response.status(404).json({ error: "Notification not found." }); return; }
  await prisma.$transaction(owned.map(t => prisma.notification.upsert({ where: { id: t.id }, create: { id: t.id, userId: request.user!.id, type: "transaction", payload: { transactionId: t.id }, readAt: new Date() }, update: { readAt: new Date() } })));
  response.json({ success: true });
 });
 return router;
}
