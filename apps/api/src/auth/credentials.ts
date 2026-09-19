import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import type { AuthDependencies } from "./dependencies.js";
import { createAuthMiddleware } from "./middleware.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { issueSession, revokeSession } from "./sessions.js";
import { publicUser } from "./account.js";
export const identityFields = {
 nickname: z.string().trim().min(1).max(40),
 username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, "Username must be 3–30 letters, numbers or underscores."),
 email: z.string().trim().toLowerCase().email().max(254),
};
const signup = z.object({ ...identityFields, password: z.string().min(12, "Use at least 12 characters for your password.").max(128) }).strict();
const login = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(128) }).strict();
// Bounded per-process throttling for this single API deployment; raw identifiers are not logged.
export function credentialLimit(): RequestHandler {
 const attempts = new Map<string, { count: number; until: number }>();
 return (req, res, next) => {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const key = req.ip ?? "unknown";
  const value = attempts.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
  if (value.count >= 30 || (!attempts.has(key) && attempts.size >= 10000)) { res.set("Retry-After", "900").status(429).json({ error: "Too many attempts. Try again in 15 minutes." }); return; }
  value.count++; attempts.set(key, value); next();
 };
}
export function createCredentialsRouter(dependencies: AuthDependencies) {
 const router = Router(); const auth = createAuthMiddleware(dependencies); const limit = credentialLimit();
 router.post("/register", limit, async (req, res) => {
  const parsed = signup.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { password, ...profile } = parsed.data;
  try {
   const user = await prisma.user.create({ data: { ...profile, passwordHash: await hashPassword(password), authProvider: "email" } });
   res.status(201).json({ ...await issueSession(user.id), user: publicUser(user) });
  } catch (e) { if ((e as {code?:string}).code === "P2002") { res.status(409).json({ error: "That email or username is already in use. Log in or choose another." }); return; } throw e; }
 });
 router.post("/login", limit, async (req, res) => {
  const parsed = login.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter your username or email and password." }); return; }
  const { identifier, password } = parsed.data;
  const user = await prisma.user.findFirst({ where: { OR: [{ username: identifier }, { email: { equals: identifier, mode: "insensitive" } }] } });
  if (!await verifyPassword(password, user?.passwordHash ?? null) || !user) { res.status(401).json({ error: "Incorrect username, email or password." }); return; }
  res.json({ ...await issueSession(user.id), user: publicUser(user) });
 });
 // An authenticated legacy account adds credentials in place, preserving every connection and transaction.
 router.post("/setup", auth, limit, async (req, res) => {
  const parsed = signup.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const { password, ...profile } = parsed.data;
  try {
   const updated = await prisma.user.updateMany({ where: { id: req.user!.id, passwordHash: null }, data: { ...profile, passwordHash: await hashPassword(password) } });
   if (updated.count !== 1) { res.status(409).json({ error: "Password login is already set up for this account." }); return; }
   const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
   res.json({ ...await issueSession(user.id), user: publicUser(user) });
  } catch (e) { if ((e as {code?:string}).code === "P2002") { res.status(409).json({ error: "That email or username is already in use." }); return; } throw e; }
 });
 router.post("/logout", async (req, res) => {
  const token = req.header("authorization")?.replace(/^Bearer /, "");
  if (token?.startsWith("kg_")) await revokeSession(token);
  res.json({ success: true });
 });
 return router;
}
