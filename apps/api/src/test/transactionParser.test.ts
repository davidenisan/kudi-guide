import { describe, expect, it } from "vitest";

import { parseTransactionMessage } from "../services/transactionParser.js";

describe("parseTransactionMessage", () => {
  it("extracts amount, merchant, and local date from a bank-style debit alert", () => {
    const parsed = parseTransactionMessage({
      chatId: "12345",
      text: "Debit Alert: NGN 2,500.00 spent at SHOPRITE IKEJA on 24/08/2026 14:35. Bal: NGN 12,000",
      receivedAt: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(parsed).toMatchObject({
      amount: 2500,
      currency: "NGN",
      merchant: "Shoprite Ikeja",
      confidenceScore: 0.82,
    });
    expect(parsed?.occurredAt.getFullYear()).toBe(2026);
    expect(parsed?.occurredAt.getMonth()).toBe(7);
    expect(parsed?.occurredAt.getDate()).toBe(24);
  });

  it("parses plain user-entered spend messages", () => {
    const parsed = parseTransactionMessage({
      chatId: "12345",
      text: "Spent ₦1200 at Chicken Republic",
      receivedAt: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(parsed).toMatchObject({
      amount: 1200,
      merchant: "Chicken Republic",
    });
  });

  it("returns null when no amount is present", () => {
    const parsed = parseTransactionMessage({
      chatId: "12345",
      text: "Lunch at Chicken Republic",
      receivedAt: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(parsed).toBeNull();
  });
});

describe("informal expense fallback", () => {
  it("accepts the user's typo and shorthand", () => {
    expect(parseTransactionMessage({ text: "Spenk 4k on Suya", chatId: "1" })).toMatchObject({ amount: 4000, merchant: "Suya", currency: "NGN" });
  });
  it("supports decimal shorthand", () => {
    expect(parseTransactionMessage({ text: "Spent 2.5k on lunch", chatId: "1" })?.amount).toBe(2500);
  });
  it.each(["How much was ₦4000?", "Actually ₦5000", "Credit alert: NGN 8000 received"]) ("does not log %s as a new expense", (text) => {
    expect(parseTransactionMessage({ text, chatId: "1" })).toBeNull();
  });
});
