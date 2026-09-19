import { publicUser } from "../auth/account.js";
import { identityFields } from "../auth/credentials.js";
import { Router } from "express";
import { z } from "zod";
import { createAuthMiddleware } from "../auth/middleware.js";
import type { AuthDependencies } from "../auth/dependencies.js";
import { prisma } from "../db/prisma.js";
export function createProfileRouter(dependencies: AuthDependencies) {
 const router = Router(); router.use(createAuthMiddleware(dependencies));
 router.patch("/", async (request, response) => {
  const parsed = z.object({ nickname: identityFields.nickname.optional(), username: identityFields.username.optional(), transactionAlerts: z.boolean().optional() }).strict().safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter a nickname between 1 and 40 characters." }); return; }
  try {
  const user = await prisma.user.update({ where: { id: request.user!.id }, data: parsed.data });
  response.json({ user: publicUser(user) });
  } catch (e) { if ((e as {code?:string}).code === "P2002") { response.status(409).json({ error: "That username is already in use." }); return; } throw e; }
 });
 return router;
}
