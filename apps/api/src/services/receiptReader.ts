import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { env } from "../config/env.js";

const run = promisify(execFile);
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_PAGES = 5;
export class ReceiptError extends Error {}
export type TelegramFile = { file_id: string; file_unique_id?: string; file_size?: number; mime_type?: string; file_name?: string };

export function detectReceiptType(bytes: Buffer): "pdf" | "image" {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")) return "image";
  throw new ReceiptError("Please send a JPEG, PNG, WebP image or PDF receipt.");
}

export async function downloadTelegramReceipt(file: TelegramFile): Promise<Buffer> {
  if (file.file_size && file.file_size > MAX_RECEIPT_BYTES) throw new ReceiptError("That file is too large. Please send a receipt smaller than 10 MB.");
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const infoResponse = await fetch(`${base}/getFile`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id: file.file_id }), signal: AbortSignal.timeout(20000) });
  const info = await infoResponse.json() as { ok: boolean; result?: { file_path?: string; file_size?: number } };
  const path = info.result?.file_path;
  if (!infoResponse.ok || !info.ok || !path || !/^[\w./-]+$/.test(path) || path.includes("..") || path.startsWith("/")) throw new ReceiptError("I couldn't download that receipt. Please send it again.");
  if ((info.result?.file_size ?? 0) > MAX_RECEIPT_BYTES) throw new ReceiptError("Please send a receipt smaller than 10 MB.");
  const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok || !response.body) throw new ReceiptError("I couldn't download that receipt. Please try again.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > MAX_RECEIPT_BYTES) { await reader.cancel(); throw new ReceiptError("Please send a receipt smaller than 10 MB."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

async function ocrImage(bytes: Buffer, directory: string, label: string) {
  const path = join(directory, `${label}.png`);
  try {
    await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize({ width: 2200, height: 3000, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).grayscale().normalize().png().toFile(path);
  } catch { throw new ReceiptError("That image is damaged or too large to read. Please send a clear, smaller image."); }
  const { stdout } = await run(env.TESSERACT_BIN, [path, "stdout", "-l", "eng", "--psm", "6"], { timeout: 30000, maxBuffer: 512 * 1024 });
  return stdout.trim();
}

export async function readReceipt(bytes: Buffer): Promise<{ text: string; pages: number; kind: "pdf" | "image" }> {
  if (bytes.length > MAX_RECEIPT_BYTES) throw new ReceiptError("Please send a receipt smaller than 10 MB.");
  const kind = detectReceiptType(bytes);
  const directory = await mkdtemp(join(tmpdir(), "kudipal-receipt-"));
  try {
    if (kind === "image") {
      const text = await ocrImage(bytes, directory, "receipt");
      if (text.length > 14000) throw new ReceiptError("Please send one receipt at a time with less text.");
      if (text.length < 8) throw new ReceiptError("I couldn't read the text. Please send a sharper, well-lit receipt photo.");
      return { text, pages: 1, kind };
    }
    const path = join(directory, "receipt.pdf"); await writeFile(path, bytes, { mode: 0o600 });
    const { stdout: info } = await run(env.PDFINFO_BIN, [path], { timeout: 15000, maxBuffer: 128 * 1024 });
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (/^Encrypted:\s+yes/im.test(info)) throw new ReceiptError("Please send an unlocked copy of the PDF.");
    if (!pages || pages > MAX_RECEIPT_PAGES) throw new ReceiptError("Please send one receipt at a time, with no more than 5 PDF pages.");
    const texts: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const { stdout } = await run(env.PDFTOTEXT_BIN, ["-f", String(page), "-l", String(page), "-layout", "-enc", "UTF-8", path, "-"], { timeout: 15000, maxBuffer: 512 * 1024 });
      let text = stdout.trim();
      if (text.replace(/\s/g, "").length < 40) {
        const prefix = join(directory, `page-${page}`);
        await run(env.PDFTOPPM_BIN, ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "2200", "-png", path, prefix], { timeout: 30000, maxBuffer: 128 * 1024 });
        text = await ocrImage(await readFile(`${prefix}.png`), directory, `ocr-${page}`);
      }
      texts.push(`Page ${page}:\n${text}`);
    }
    const text = texts.join("\n\n");
    if (text.length > 14000) throw new ReceiptError("That document contains too much text. Please send only the receipt page, not a full statement.");
    if (text.replace(/Page \d+:/g, "").trim().length < 8) throw new ReceiptError("I couldn't read that PDF. Please send a clearer scan or photo.");
    return { text, pages, kind };
  } catch (error) {
    if (error instanceof ReceiptError) throw error;
    throw new ReceiptError("I couldn't read that file. It may be locked, damaged, or the local OCR/PDF tools may be unavailable. Try a clear photo or type the expense.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
