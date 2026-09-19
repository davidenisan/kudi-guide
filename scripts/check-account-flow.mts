import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../apps/api/src/db/prisma.js";
import { JwtService } from "../apps/api/src/auth/jwt.js";
import { env } from "../apps/api/src/config/env.js";
const web = "http://localhost:3000";
const tag = randomUUID().slice(0,8);
const credentials = { nickname: "Account QA", username: `qa_${tag}`, email: `qa_${tag}@example.test`, password: `QA-only-${randomUUID()}` };
const userIds: string[] = [];
async function call(path: string, body?: unknown, cookie?: string, method?: string) {
 const response = await fetch(`${web}${path}`, { method: method ?? (body ? "POST" : "GET"), headers: { "content-type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
 const result = await response.json();
 return { status: response.status, result, cookie: response.headers.get("set-cookie")?.split(";")[0], headers: response.headers };
}
try {
 const registered = await call("/api/auth/register", credentials);
 assert.equal(registered.status, 201, JSON.stringify(registered.result));
 userIds.push(registered.result.user.id);
 assert.ok(registered.cookie); assert.match(registered.headers.get("set-cookie")!, /Max-Age=2592000/i); assert.match(registered.headers.get("set-cookie")!, /HttpOnly/i);
 assert.equal(registered.result.user.nickname, credentials.nickname);
 assert.equal(registered.result.user.passwordHash, undefined);
 for (let i=0;i<3;i++) { const me=await call("/api/auth/me",undefined,registered.cookie); assert.equal(me.status,200);assert.equal(me.result.user.id,userIds[0]); }
 const connections=await call("/api/telegram/status",undefined,registered.cookie); assert.equal(connections.status,200);assert.equal(connections.result.linked,false);
 const updated=await call("/api/profile",{nickname:"QA Updated",username:`updated_${tag}`},registered.cookie,"PATCH");assert.equal(updated.status,200);
 const loggedOut=await call("/api/auth/logout",{},registered.cookie); assert.equal(loggedOut.status,200);
 assert.equal((await call("/api/auth/me",undefined,registered.cookie)).status,401);
 for (const identifier of [`UPDATED_${tag.toUpperCase()}`,credentials.email.toUpperCase()]) {
  const loggedIn=await call("/api/auth/login",{identifier,password:credentials.password}); assert.equal(loggedIn.status,200);assert.equal(loggedIn.result.user.nickname,"QA Updated");
  assert.equal((await call("/api/auth/me",undefined,loggedIn.cookie)).status,200);
  await call("/api/auth/logout",{},loggedIn.cookie);
 }
 const legacy=await prisma.user.create({data:{authProvider:"oauth",telegramChatId:`qa_${tag}`}});userIds.push(legacy.id);
 await prisma.transaction.create({data:{userId:legacy.id,source:"telegram",amount:4000,currency:"NGN",merchant:"QA Suya",occurredAt:new Date()}});
 const token=new JwtService(env.JWT_SECRET, "15m").signAccessToken({sub:legacy.id,phone:null});
 const setup=await call("/api/auth/setup",{...credentials,username:`legacy_${tag}`,email:`legacy_${tag}@example.test`},`kg_access_token=${token}`);
 assert.equal(setup.status,200,JSON.stringify(setup.result));assert.equal(setup.result.user.id,legacy.id);
 const preserved=await prisma.user.findUniqueOrThrow({where:{id:legacy.id},include:{transactions:true}});assert.equal(preserved.telegramChatId,`qa_${tag}`);assert.equal(preserved.transactions.length,1);
 assert.equal((await call("/api/auth/setup",credentials,setup.cookie)).status,409);
 console.log("PASS: real web/API/database signup, 30-day HttpOnly cookie, repeated authenticated loads, profile updates, username/email login, logout revocation, and legacy migration preserving transactions + Telegram link. No Telegram messages sent.");
} finally {
 for(const id of userIds) await prisma.user.delete({where:{id}});
 await prisma.$disconnect();
}
