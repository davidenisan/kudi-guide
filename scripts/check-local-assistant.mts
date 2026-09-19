import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { interpretMoneyMessage, modelHealth } from "../apps/api/src/services/moneyAssistant.js";
import { readReceipt } from "../apps/api/src/services/receiptReader.js";
const originalFetch = globalThis.fetch;
if (process.env.DEBUG_MODEL === "true") globalThis.fetch = async (...args) => {
 const response = await originalFetch(...args);
 if (String(args[0]).includes("/api/chat")) console.log("Synthetic test model output:", await response.clone().text());
 return response;
};
const now = new Date("2026-09-19T13:00:00Z");
const context = { pending: null, last: null, history: [] };
const checks = [
 { text: "Spenk 4k on Suya", expected: { intent: "expense", amount: 4000, category: "Food" }, context },
 { text: "actually 5k", expected: { intent: "correct", amount: 5000, merchant: "Suya" }, context: { ...context, last: { amount: 4000, currency: "NGN", merchant: "Suya", category: "Food" } } },
 { text: "how much did I spend today?", expected: { intent: "summary", period: "today" }, context },
];
for (const test of checks) {
 const start = Date.now(); const result = await interpretMoneyMessage({ text: test.text, now, context: test.context });
 assert.equal(modelHealth.available, true, "Expected real model inference, not fallback");
 for (const [key, value] of Object.entries(test.expected)) assert.equal(result[key as keyof typeof result], value, `${test.text}: ${key}`);
 console.log(JSON.stringify({ input: test.text, result, seconds: (Date.now() - start) / 1000 }));
}
for (const name of ["receipt.png", "receipt-text.pdf", "receipt-scan.pdf"]) {
 const receipt = await readReceipt(await readFile(new URL(`../apps/api/src/test/fixtures/${name}`, import.meta.url)));
 const result = await interpretMoneyMessage({ text: "Read my receipt", receiptText: receipt.text, now, context });
 assert.equal(modelHealth.available, true); assert.equal(result.intent, "expense"); assert.equal(result.amount, 4000); assert.equal(result.merchant?.toLowerCase(), "suya spot");
 console.log(JSON.stringify({ fixture: name, result }));
}
