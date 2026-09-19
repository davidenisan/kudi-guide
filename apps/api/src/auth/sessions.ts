import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function issueSession(userId: string) {
 const accessToken = `kg_${randomBytes(32).toString("hex")}`;
 await prisma.session.deleteMany({ where: { userId, expiresAt: { lte: new Date() } } });
 await prisma.session.create({ data: { tokenHash: sessionHash(accessToken), userId, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
 return { accessToken, expiresIn: SESSION_SECONDS };
}
export async function sessionUserId(token: string) {
 if (!/^kg_[a-f0-9]{64}$/.test(token)) return null;
 const session = await prisma.session.findUnique({ where: { tokenHash: sessionHash(token) } });
 return session && session.expiresAt > new Date() ? session.userId : null;
}
export async function revokeSession(token: string) {
 await prisma.session.deleteMany({ where: { tokenHash: sessionHash(token) } });
}
