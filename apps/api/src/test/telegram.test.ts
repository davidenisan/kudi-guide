import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AuthDependencies } from "../auth/dependencies.js";
const db = vi.hoisted(() => ({ telegramLogin: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() }, user: { upsert: vi.fn(), findUnique: vi.fn() }, transaction: { upsert: vi.fn() }, telegramTurn: { findUnique: vi.fn(), create: vi.fn() }, telegramConversation: { findUnique: vi.fn(), upsert: vi.fn() }, category: { upsert: vi.fn() }, $transaction: vi.fn() }));
vi.mock("../db/prisma.js", () => ({ prisma: db }));
vi.mock("../config/env.js", () => ({ env: { TELEGRAM_BOT_TOKEN: "test-only", TELEGRAM_WEBHOOK_SECRET: "test-secret" } }));
const { createTelegramRouter, processTelegramUpdate, telegramHealth } = await import("../routes/telegram.js");
const sign = vi.fn(() => "signed-test-token");
const app = express(); app.use(express.json()); app.use(createTelegramRouter({ jwtService: { signAccessToken: sign }, userRepository: {} } as unknown as AuthDependencies));
const verifier="browser-secret";
const login = { code:"random-code", verifierHash:createHash("sha256").update(verifier).digest("hex"), expiresAt:new Date(Date.now()+60000), chatId:"123" };
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true}));db.$transaction.mockImplementation(fn=>fn(db));telegramHealth.online=true;telegramHealth.username="KudiPalBot";});
afterEach(()=>vi.unstubAllGlobals());
describe("Telegram sign-in",()=>{
 it("keeps the browser verifier out of the Telegram deep link",async()=>{db.telegramLogin.deleteMany.mockResolvedValue({count:0});db.telegramLogin.create.mockResolvedValue({});const r=await request(app).post("/login").send({}).expect(200);expect(r.body.url).toBe(`https://t.me/KudiPalBot?start=login_${r.body.code}`);expect(r.body.url).not.toContain(r.body.verifier);expect(db.telegramLogin.create.mock.calls[0][0].data.verifierHash).not.toBe(r.body.verifier);});
 it("rejects polling with the bot code alone",async()=>{db.telegramLogin.findUnique.mockResolvedValue(login);await request(app).post("/login/check").send({code:login.code,verifier:"wrong"}).expect(410);expect(sign).not.toHaveBeenCalled();});
 it("waits for Telegram approval",async()=>{db.telegramLogin.findUnique.mockResolvedValue({...login,chatId:null});const r=await request(app).post("/login/check").send({code:login.code,verifier}).expect(200);expect(r.body).toEqual({pending:true});expect(sign).not.toHaveBeenCalled();});
 it("rejects expired approval",async()=>{db.telegramLogin.findUnique.mockResolvedValue({...login,expiresAt:new Date(0)});await request(app).post("/login/check").send({code:login.code,verifier}).expect(410);});
 it("consumes approved sign-in once and reuses the linked account",async()=>{db.telegramLogin.findUnique.mockResolvedValue(login);db.telegramLogin.deleteMany.mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});db.user.findUnique.mockResolvedValueOnce({id:"user-1",phone:null});const r=await request(app).post("/login/check").send({code:login.code,verifier}).expect(200);expect(r.body.accessToken).toBe("signed-test-token");expect(db.user.findUnique.mock.calls[0][0].where).toEqual({telegramChatId:"123"});await request(app).post("/login/check").send({code:login.code,verifier}).expect(410);expect(sign).toHaveBeenCalledTimes(1);});
 it("does not bypass password login with Telegram",async()=>{db.telegramLogin.findUnique.mockResolvedValue(login);db.telegramLogin.deleteMany.mockResolvedValue({count:1});db.user.findUnique.mockResolvedValue({id:"user-1",passwordHash:"set"});await request(app).post("/login/check").send({code:login.code,verifier}).expect(409);expect(sign).not.toHaveBeenCalled();});
 it("does not create new accounts through legacy Telegram sign-in",async()=>{db.telegramLogin.findUnique.mockResolvedValue(login);db.telegramLogin.deleteMany.mockResolvedValue({count:1});db.user.findUnique.mockResolvedValue(null);await request(app).post("/login/check").send({code:login.code,verifier}).expect(410);expect(db.user.upsert).not.toHaveBeenCalled();});

});
describe("Telegram ingestion",()=>{
 it("rejects untrusted webhooks",async()=>{await request(app).post("/webhook").send({}).expect(401);expect(db.user.findUnique).not.toHaveBeenCalled();});
 it("ignores group messages",async()=>{await processTelegramUpdate({message:{chat:{id:123,type:"group"},text:"Spent ₦2500 at Shoprite"}});expect(db.user.findUnique).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
 it("uses the linked owner and the same deduplication key on retries",async()=>{db.user.findUnique.mockResolvedValue({id:"owner-1"});db.category.upsert.mockResolvedValue({id:"food"});db.transaction.upsert.mockResolvedValue({id:"tx-1",amount:{toNumber:()=>2500},currency:"NGN",merchant:"Shoprite"});const update={message:{date:1756000000,chat:{id:123,type:"private"},text:"Spent ₦2500 at Shoprite"}};await processTelegramUpdate(update);await processTelegramUpdate(update);const writes=db.transaction.upsert.mock.calls;expect(writes[0][0].where.dedupHash).toBe(writes[1][0].where.dedupHash);expect(writes[0][0].create).toMatchObject({userId:"owner-1",source:"telegram",amount:2500,currency:"NGN"});});
});
