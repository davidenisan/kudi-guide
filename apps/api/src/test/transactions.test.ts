import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthDependencies } from "../auth/dependencies.js";
const db = vi.hoisted(()=>({transaction:{findMany:vi.fn(),findFirst:vi.fn(),create:vi.fn(),update:vi.fn()},category:{upsert:vi.fn()}}));
vi.mock("../db/prisma.js",()=>({prisma:db}));
const {createTransactionsRouter}=await import("../routes/transactions.js");
const app=express();app.use(express.json());app.use(createTransactionsRouter({jwtService:{verifyAccessToken:()=>({sub:"owner"})},userRepository:{findById:async()=>({id:"owner",phone:null})}} as unknown as AuthDependencies));
beforeEach(()=>vi.clearAllMocks());
it("requires authentication for manual entry",async()=>{await request(app).post("/").send({}).expect(401);expect(db.transaction.create).not.toHaveBeenCalled();});
it("rejects non-positive expense amounts",async()=>{await request(app).post("/").set("Authorization","Bearer test").send({merchant:"Test",amount:-1,category:"Food",occurredAt:new Date().toISOString()}).expect(400);expect(db.transaction.create).not.toHaveBeenCalled();});
it("creates manual expenses for the authenticated account",async()=>{db.category.upsert.mockResolvedValue({id:"food"});db.transaction.create.mockResolvedValue({id:"new"});await request(app).post("/").set("Authorization","Bearer test").send({merchant:"Test",amount:1500,category:"Food",occurredAt:new Date().toISOString()}).expect(201);expect(db.transaction.create.mock.calls[0][0].data).toMatchObject({userId:"owner",amount:1500,currency:"NGN",source:"manual",status:"confirmed"});});
it("does not confirm another account's transaction",async()=>{db.transaction.findFirst.mockResolvedValue(null);await request(app).patch("/someone-elses-transaction").set("Authorization","Bearer test").send({category:"Food"}).expect(404);expect(db.transaction.findFirst).toHaveBeenCalledWith({where:{id:"someone-elses-transaction",userId:"owner"}});expect(db.transaction.update).not.toHaveBeenCalled();});

it("paginates filtered transactions without crossing accounts",async()=>{
 const transaction={id:"row",amount:{toNumber:()=>4000},currency:"NGN",occurredAt:new Date(),category:{name:"Food"}};
 db.transaction.findMany.mockResolvedValueOnce(Array.from({length:51},()=>transaction)).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 const result=await request(app).get("/?page=2&search=suya&status=review").set("Authorization","Bearer test").expect(200);
 expect(result.body.transactions).toHaveLength(50);expect(result.body.hasMore).toBe(true);expect(result.body.page).toBe(2);
 expect(db.transaction.findMany.mock.calls[0][0]).toMatchObject({where:{userId:"owner",status:"needs_review",OR:[{merchant:{contains:"suya",mode:"insensitive"}},{category:{name:{contains:"suya",mode:"insensitive"}}}]},skip:50,take:51});
});
it("rejects invalid transaction pagination",async()=>{
 await request(app).get("/?page=0").set("Authorization","Bearer test").expect(400);
 expect(db.transaction.findMany).not.toHaveBeenCalled();
});
it("keeps metric totals and linked Naira transactions in the requested period",async()=>{
 db.transaction.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{amount:{toNumber:()=>4000},currency:"NGN",category:{name:"Food"}},{amount:{toNumber:()=>15},currency:"USD",category:{name:"Subscriptions"}}]).mockResolvedValueOnce([]);
 const result=await request(app).get("/?period=year&summaryPeriod=year&currency=NGN").set("Authorization","Bearer test").expect(200);
 const list=db.transaction.findMany.mock.calls[0][0],summary=db.transaction.findMany.mock.calls[1][0];
 expect(list.where.currency).toBe("NGN");expect(list.where.occurredAt).toEqual(summary.where.occurredAt);
 expect(list.orderBy).toEqual([{occurredAt:"desc"},{id:"desc"}]);
 expect(result.body.summary).toMatchObject({totalSpend:4000,transactionCount:1});
});
it("rejects unknown periods",async()=>{await request(app).get("/?summaryPeriod=invalid").set("Authorization","Bearer test").expect(400);expect(db.transaction.findMany).not.toHaveBeenCalled();});
