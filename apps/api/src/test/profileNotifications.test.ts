import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthDependencies } from "../auth/dependencies.js";

const db = vi.hoisted(() => ({ user: { update: vi.fn() }, transaction: { findMany: vi.fn() }, notification: { findMany: vi.fn(), upsert: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
const { createProfileRouter } = await import("../routes/profile.js");
const { createNotificationsRouter } = await import("../routes/notifications.js");
const dependencies = { jwtService: { verifyAccessToken: () => ({ sub: "owner" }) }, userRepository: { findById: async () => ({ id: "owner", phone: null }) } } as unknown as AuthDependencies;
const app = express();
app.use(express.json());
app.use("/profile", createProfileRouter(dependencies));
app.use("/notifications", createNotificationsRouter(dependencies));
const id = "a61b94aa-d65c-4c61-8413-089582c2c415";
beforeEach(() => vi.clearAllMocks());

it("requires authentication for profile and inbox access", async () => {
 await request(app).patch("/profile").send({ nickname: "Ada" }).expect(401);
 await request(app).get("/notifications").expect(401);
 await request(app).patch("/notifications").send({ ids: [id] }).expect(401);
 expect(db.user.update).not.toHaveBeenCalled();
});
it("saves a trimmed nickname and alert preference only for the signed-in user", async () => {
 db.user.update.mockResolvedValue({ id: "owner", nickname: "Ada", phone: null, transactionAlerts: false });
 const result = await request(app).patch("/profile").set("Authorization", "Bearer test").send({ nickname: " Ada ", transactionAlerts: false }).expect(200);
 expect(db.user.update).toHaveBeenCalledWith({ where: { id: "owner" }, data: { nickname: "Ada", transactionAlerts: false } });
 expect(result.body.user.nickname).toBe("Ada");
});
it("rejects blank nicknames and account-id injection", async () => {
 for (const body of [{ nickname: "  " }, { nickname: "Ada", id: "other" }]) await request(app).patch("/profile").set("Authorization", "Bearer test").send(body).expect(400);
 expect(db.user.update).not.toHaveBeenCalled();
});
it("returns account-scoped notifications with persisted read state", async () => {
 db.transaction.findMany.mockResolvedValue([{ id, status: "needs_review", merchant: "Suya", amount: { toNumber: () => 4000 }, currency: "NGN", occurredAt: new Date("2026-09-19T10:00:00Z") }]);
 db.notification.findMany.mockResolvedValue([{ id }]);
 const result = await request(app).get("/notifications").set("Authorization", "Bearer test").expect(200);
 expect(db.transaction.findMany.mock.calls[0][0].where).toEqual({ userId: "owner", status: { not: "duplicate" } });
 expect(db.notification.findMany.mock.calls[0][0].where.userId).toBe("owner");
 expect(result.body.notifications[0]).toMatchObject({ id, amount: 4000, read: true, title: "Expense ready to review" });
});
it("does not mark another account's transaction as read", async () => {
 db.transaction.findMany.mockResolvedValue([]);
 await request(app).patch("/notifications").set("Authorization", "Bearer test").send({ ids: [id] }).expect(404);
 expect(db.transaction.findMany).toHaveBeenCalledWith({ where: { id: { in: [id] }, userId: "owner" }, select: { id: true } });
 expect(db.notification.upsert).not.toHaveBeenCalled();
});
it("persists read markers and accepts repeated ids safely", async () => {
 db.transaction.findMany.mockResolvedValue([{ id }]);
 db.notification.upsert.mockResolvedValue({ id });
 db.$transaction.mockResolvedValue([]);
 await request(app).patch("/notifications").set("Authorization", "Bearer test").send({ ids: [id, id] }).expect(200);
 expect(db.notification.upsert).toHaveBeenCalledTimes(1);
 expect(db.notification.upsert.mock.calls[0][0].create).toMatchObject({ id, userId: "owner", readAt: expect.any(Date) });
 expect(db.$transaction).toHaveBeenCalledTimes(1);
});
