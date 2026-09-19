import assert from "node:assert/strict";
import { prisma } from "../apps/api/src/db/prisma.js";
import { handleAssistantMessage } from "../apps/api/src/services/telegramAssistant.js";
const user = await prisma.user.create({ data: { authProvider: "oauth" } });
try {
 const base = { userId: user.id, chatId: `synthetic-${user.id}`, receivedAt: new Date() };
 const first = await handleAssistantMessage({ ...base, messageId: 1, text: "Spenk 4k on Suya" });
 assert.match(first, /4,000/);
 const again = await handleAssistantMessage({ ...base, messageId: 1, text: "Spenk 4k on Suya" });
 assert.equal(first, again); assert.equal(await prisma.transaction.count({ where: { userId: user.id } }), 1);
 const correction = await handleAssistantMessage({ ...base, messageId: 2, text: "actually 5k" });
 assert.match(correction, /Updated/);
 assert.equal((await prisma.transaction.findFirstOrThrow({ where: { userId: user.id } })).amount.toNumber(), 5000);
 const summary = await handleAssistantMessage({ ...base, receivedAt: new Date(), messageId: 4, text: "/summary today" });
 assert.match(summary, /5,000/); assert.equal(await prisma.transaction.count({ where: { userId: user.id } }), 1);
 console.log("PASS: real model + database, expense creation, replay protection, immediate contextual correction and summary. No bot messages sent.");
} finally { await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect(); }
