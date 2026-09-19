import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { detectReceiptType, readReceipt, ReceiptError, MAX_RECEIPT_BYTES } from "../services/receiptReader.js";
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));
it.each(["receipt.png", "receipt-text.pdf", "receipt-scan.pdf"])("extracts the actual total from %s", async (name) => {
 const result = await readReceipt(await fixture(name)); expect(result.pages).toBe(1); expect(result.text).toMatch(/SUYA SPOT/i); expect(result.text).toMatch(/4,000\.00/); expect(result.text).toContain("TOTAL");
}, 60000);
it("rejects unsupported payloads regardless of file extension", () => {
 expect(() => detectReceiptType(Buffer.from('<script>evil</script>'))).toThrow(ReceiptError);
});
it("rejects documents exceeding the page limit rather than silently dropping pages", async () => {
 await expect(readReceipt(await fixture("too-many-pages.pdf"))).rejects.toThrow("5 PDF pages");
});
it("rejects oversized inputs before decoding", async () => {
 await expect(readReceipt(Buffer.alloc(MAX_RECEIPT_BYTES + 1))).rejects.toThrow("10 MB");
});
