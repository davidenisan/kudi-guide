import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthDependencies } from "../auth/dependencies.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
const db = vi.hoisted(() => ({ user: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() }, session: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() } }));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
const { createCredentialsRouter } = await import("../auth/credentials.js");
const { createAuthMiddleware } = await import("../auth/middleware.js");
const { sessionHash } = await import("../auth/sessions.js");
const profile = { email: "ada@example.test", username: "ada_money", nickname: "Ada", password: "Test-only-passphrase-123" };
const user = { id: "owner", phone: null, ...profile, password: undefined, passwordHash: "private-hash" };
const dependencies = { jwtService: { verifyAccessToken: () => ({ sub: "owner" }) }, userRepository: { findById: async () => user } } as unknown as AuthDependencies;
function app() { const app = express(); app.use(express.json()); app.use(createCredentialsRouter(dependencies)); app.get("/private", createAuthMiddleware(dependencies), (req,res) => res.json({ id: req.user!.id })); return app; }
beforeEach(() => vi.resetAllMocks());
it("hashes salted passwords and rejects invalid passwords", async () => {
 const hash = await hashPassword(profile.password);
 expect(hash).not.toContain(profile.password);
 expect(await hashPassword(profile.password)).not.toBe(hash);
 expect(await verifyPassword(profile.password, hash)).toBe(true);
 expect(await verifyPassword("wrong", hash)).toBe(false);
 expect(await verifyPassword(profile.password, null)).toBe(false);
 expect(await verifyPassword(profile.password, "broken")).toBe(false);
});
it("registers normalized credentials and issues a hashed 30-day session", async () => {
 db.user.create.mockResolvedValue(user);
 const result = await request(app()).post("/register").send({ ...profile, email: " ADA@EXAMPLE.TEST ", username: " Ada_Money " }).expect(201);
 expect(db.user.create.mock.calls[0][0].data).toMatchObject({ email: profile.email, username: profile.username, nickname: "Ada", authProvider: "email" });
 expect(db.user.create.mock.calls[0][0].data.passwordHash).toMatch(/^scrypt-v1\$/);
 expect(result.body.user.passwordHash).toBeUndefined(); expect(result.body.user.password).toBeUndefined();
 expect(result.body.expiresIn).toBe(2592000);
 expect(db.session.create.mock.calls[0][0].data.tokenHash).toBe(sessionHash(result.body.accessToken));
 expect(db.session.create.mock.calls[0][0].data.tokenHash).not.toBe(result.body.accessToken);
});
it("rejects weak passwords and duplicate identities", async () => {
 const server = app();
 await request(server).post("/register").send({ ...profile, password: "short" }).expect(400);
 expect(db.user.create).not.toHaveBeenCalled();
 db.user.create.mockRejectedValue({ code: "P2002" });
 await request(server).post("/register").send(profile).expect(409);
 expect(db.session.create).not.toHaveBeenCalled();
});
it("logs in with a username or email and uses a generic wrong-credential error", async () => {
 const server = app(); const passwordHash = await hashPassword(profile.password);
 db.user.findFirst.mockResolvedValue({ ...user, passwordHash });
 for (const identifier of ["ADA_MONEY", "ADA@EXAMPLE.TEST"]) {
  await request(server).post("/login").send({ identifier, password: profile.password }).expect(200);
  expect(db.user.findFirst.mock.lastCall![0].where.OR[0].username).toBe(identifier.toLowerCase());
 }
 const wrong = await request(server).post("/login").send({ identifier: "ada_money", password: "wrong" }).expect(401);
 db.user.findFirst.mockResolvedValue(null);
 const missing = await request(server).post("/login").send({ identifier: "missing", password: "wrong" }).expect(401);
 expect(wrong.body).toEqual(missing.body);
});
it("sets up the existing account in place only once", async () => {
 const server = app();
 await request(server).post("/setup").send(profile).expect(401);
 db.user.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
 db.user.findUniqueOrThrow.mockResolvedValue(user);
 await request(server).post("/setup").set("Authorization", "Bearer legacy").send(profile).expect(200);
 expect(db.user.updateMany.mock.calls[0][0].where).toEqual({ id: "owner", passwordHash: null });
 expect(db.user.create).not.toHaveBeenCalled();
 await request(server).post("/setup").set("Authorization", "Bearer legacy").send(profile).expect(409);
});
it("survives repeated requests and rejects expired or revoked sessions", async () => {
 const server = app(); const token = `kg_${"a".repeat(64)}`;
 db.session.findUnique.mockResolvedValue({ userId: "owner", expiresAt: new Date(Date.now()+3600000) });
 for (let i=0;i<3;i++) await request(server).get("/private").set("Authorization", `Bearer ${token}`).expect(200);
 db.session.findUnique.mockResolvedValue({ userId: "owner", expiresAt: new Date(0) });
 await request(server).get("/private").set("Authorization", `Bearer ${token}`).expect(401);
 await request(server).post("/logout").set("Authorization", `Bearer ${token}`).expect(200);
 expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: sessionHash(token) } });
 db.session.findUnique.mockResolvedValue(null);
 await request(server).get("/private").set("Authorization", `Bearer ${token}`).expect(401);
});
it("throttles repeated login attempts", async () => {
 const server = app();
 for (let i=0;i<30;i++) await request(server).post("/login").send({}).expect(400);
 await request(server).post("/login").send({}).expect(429);
});
