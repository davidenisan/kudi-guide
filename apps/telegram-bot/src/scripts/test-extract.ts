import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { extractFields, looksLikeReceipt } from "../core/receipt/extract.js";
import { extractText, isOcrReachable, type OcrResult } from "../core/receipt/ocr-client.js";

/**
 * Runs extraction over a folder of receipts and prints what came out of each.
 *
 * Section 5 calls a real test set "the cheapest insurance you have" and says not
 * to skip it. This is the tool for that: point it at testset/ and read the
 * fields it found, field by field, against what the images actually say.
 *
 * Amount is printed first and separately, because a wrong amount is the one
 * failure the spec calls unacceptable.
 */

const TESTSET = resolve(process.cwd(), "testset");
const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf"]);

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function describe(result: OcrResult, name: string): void {
  const receipt = looksLikeReceipt(result);
  const fields = extractFields(result);

  console.log(`\n${"─".repeat(72)}\n${name}`);
  console.log(`  source: ${result.source}   lines: ${result.lines.length}   bank: ${fields.bank ?? "unrecognised"}`);
  console.log(`  is a receipt: ${receipt.isReceipt ? "yes" : "NO"} (${receipt.reason})`);

  const amount = fields.amountKobo;
  console.log(
    `\n  AMOUNT      ${amount ? naira(amount.value).padEnd(18) : "— not found".padEnd(18)}` +
      `${amount ? `conf ${amount.confidence.toFixed(3)}  from ${JSON.stringify(amount.sourceText)}` : ""}`,
  );

  const rows: [string, string, number | null][] = [
    ["merchant", fields.merchant?.value ?? "—", fields.merchant?.confidence ?? null],
    ["date", fields.transactionDate?.value.toISOString().slice(0, 16).replace("T", " ") ?? "—", fields.transactionDate?.confidence ?? null],
    ["type", fields.transactionType?.value ?? "—", fields.transactionType?.confidence ?? null],
    ["reference", fields.referenceNumber?.value ?? "—", fields.referenceNumber?.confidence ?? null],
    ["sender", fields.sender?.value ?? "—", fields.sender?.confidence ?? null],
    ["currency", fields.currency ?? "—", null],
  ];

  for (const [label, value, confidence] of rows) {
    console.log(`  ${label.padEnd(11)} ${String(value).slice(0, 44).padEnd(46)}${confidence !== null ? `conf ${confidence.toFixed(3)}` : ""}`);
  }

  if (process.argv.includes("--lines")) {
    console.log("\n  raw OCR:");
    for (const line of result.lines) {
      console.log(`    ${line.confidence.toFixed(3)}  ${line.text}`);
    }
  }
}

async function main(): Promise<void> {
  if (!(await isOcrReachable())) {
    console.error("OCR service is not running. Start it with:  ./ocr/run.sh");
    process.exitCode = 1;
    return;
  }

  const explicit = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  let files: string[];

  if (explicit.length > 0) {
    files = explicit.map((file) => resolve(file));
  } else {
    const names = await readdir(TESTSET).catch(() => []);
    files = names
      .filter((name) => IMAGE_TYPES.has(extname(name).toLowerCase()))
      .sort()
      .map((name) => resolve(TESTSET, name));
  }

  if (files.length === 0) {
    console.log(`No receipts found in ${TESTSET}`);
    console.log("Drop real screenshots there, or pass paths: npm run test:extract -- path/to/receipt.png");
    return;
  }

  console.log(`Reading ${files.length} receipt(s)…`);
  const started = Date.now();

  for (const file of files) {
    const bytes = await readFile(file);
    try {
      const result = await extractText(bytes, mimeFor(file));
      describe(result, file.split("/").pop() ?? file);
    } catch (error) {
      console.log(`\n${"─".repeat(72)}\n${file.split("/").pop()}\n  FAILED: ${String(error)}`);
    }
  }

  console.log(`\n${"─".repeat(72)}`);
  console.log(`${files.length} receipt(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
