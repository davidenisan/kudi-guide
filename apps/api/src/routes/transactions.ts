import { transactionPeriodStart } from "../services/transactionPeriod.js";
import { z } from "zod";
import { Router } from "express";

import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthDependencies } from "../auth/dependencies.js";
import { prisma } from "../db/prisma.js";

export function createTransactionsRouter(authDependencies: AuthDependencies) {
  const router = Router();
  const requireAuth = createAuthMiddleware(authDependencies);

  router.get("/", requireAuth, async (request, response) => {
    const user = request.user;

    if (!user) {
      response.status(401).json({ error: "Not authenticated." });
      return;
    }

    const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), search: z.string().max(120).default(""), status: z.enum(["all", "review"]).default("all"), period: z.enum(["today", "week", "month", "year", "all"]).default("all"), summaryPeriod: z.enum(["today", "week", "month", "year", "all"]).default("month"), currency: z.enum(["NGN", "USD"]).optional() }).safeParse(request.query);
    if (!query.success) { response.status(400).json({ error: "Invalid transaction filters." }); return; }
    const { page, search, status, period, summaryPeriod, currency } = query.data;
    const now = new Date();
    const summaryStart = transactionPeriodStart(now, summaryPeriod);
    const listStart = transactionPeriodStart(now, period);
    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id, ...(listStart ? { occurredAt: { gte: listStart, lte: now } } : {}), ...(currency ? { currency } : {}), ...(status === "review" ? { status: "needs_review" as const } : {}), ...(search ? { OR: [{ merchant: { contains: search, mode: "insensitive" as const } }, { category: { name: { contains: search, mode: "insensitive" as const } } }] } : {}) },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 50,
      take: 51,
      include: { category: true },
    });
    const monthlyTransactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        occurredAt: {
          ...(summaryStart ? { gte: summaryStart } : {}),
          lte: now,
        },
      },
      include: { category: true },
    });

    const categoryTotals = new Map<string, number>();
    let totalSpend = 0;

    for (const transaction of monthlyTransactions) {
      const amount = transaction.amount.toNumber();
      if (transaction.currency !== "NGN") continue;
      totalSpend += amount;
      const categoryName = transaction.category?.name ?? "Other";
      categoryTotals.set(categoryName, (categoryTotals.get(categoryName) ?? 0) + amount);
    }

    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);
    const activity = await prisma.transaction.findMany({ where: { userId: user.id, occurredAt: { gte: weekStart, lte: now } }, select: { occurredAt: true } });
    response.json({
      hasMore: transactions.length > 50,
      page,
      activity: activity.map((item) => item.occurredAt.toISOString()),
      summary: {
        totalSpend,
        transactionCount: monthlyTransactions.filter(t => t.currency === "NGN").length,
        categories: [...categoryTotals.entries()]
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 6),
      },
      transactions: transactions.slice(0, 50).map((transaction) => ({
        id: transaction.id,
        source: transaction.source,
        amount: transaction.amount.toNumber(),
        currency: transaction.currency,
        merchant: transaction.merchant,
        category: transaction.category?.name ?? "Other",
        occurredAt: transaction.occurredAt.toISOString(),
        confidenceScore: transaction.confidenceScore,
        status: transaction.status,
      })),
    });
  });

  const transactionSchema = z.object({
    merchant: z.string().trim().min(1).max(120),
    amount: z.number().positive().max(999999999999.99),
    currency: z.enum(["NGN", "USD"]).default("NGN"),
    category: z.string().trim().min(1).max(80),
    occurredAt: z.string().datetime(),
  });
  router.post("/", requireAuth, async (request, response) => {
    const parsed = transactionSchema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Enter a valid merchant, amount, category and date." }); return; }
    const { category: name, ...data } = parsed.data;
    const category = await prisma.category.upsert({ where: { name }, create: { name }, update: {} });
    const transaction = await prisma.transaction.create({ data: { ...data, occurredAt: new Date(data.occurredAt), categoryId: category.id, userId: request.user!.id, source: "manual", status: "confirmed" } });
    response.status(201).json({ id: transaction.id });
  });
  router.patch("/:id", requireAuth, async (request, response) => {
    const parsed = z.object({ category: z.string().trim().min(1).max(80) }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Choose a valid category." }); return; }
    const transaction = await prisma.transaction.findFirst({ where: { id: String(request.params.id), userId: request.user!.id } });
    if (!transaction) { response.status(404).json({ error: "Transaction not found." }); return; }
    const name = parsed.data.category;
    const category = await prisma.category.upsert({ where: { name }, create: { name }, update: {} });
    await prisma.transaction.update({ where: { id: transaction.id }, data: { categoryId: category.id, status: "confirmed" } });
    response.json({ success: true });
  });

  return router;
}
