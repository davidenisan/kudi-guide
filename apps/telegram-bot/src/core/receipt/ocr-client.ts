import { env } from "../../config/env.js";
import { logger } from "../../logger.js";

/**
 * The one place the OCR engine is spoken to.
 *
 * Section 5 asks for extraction to sit behind a single interface so that
 * swapping PaddleOCR for something else is a contained change. This is that
 * seam: everything above works on OcrResult and has no idea a Python process
 * exists, let alone which one.
 *
 * The service is expected to be already running. Starting and supervising it is
 * an operational concern, not something to do from inside a message handler —
 * the models take a second or two to load, and a bot that shells out per receipt
 * would pay that every time.
 */

export interface OcrBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OcrLine {
  text: string;
  /** 0..1 from the engine. Null when the text came from a PDF's own text layer. */
  confidence: number;
  /** Null for text-layer PDFs, which have no pixels to point at. */
  box: OcrBox | null;
}

export interface OcrResult {
  lines: OcrLine[];
  width: number;
  height: number;
  /**
   * How the text was obtained. A PDF text layer is exact and deserves more
   * trust than anything OCR produces (Section 5).
   */
  source: "ocr" | "pdf-text-layer";
}

export class OcrUnavailableError extends Error {}

/**
 * Reads the text out of a receipt.
 *
 * Throws OcrUnavailableError when the service cannot be reached, which the
 * pipeline treats differently from "this file is unreadable": the first is our
 * problem and the user should be asked to try again, the second is theirs.
 */
export async function extractText(bytes: Buffer, mimeType: string | undefined): Promise<OcrResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.OCR_SERVICE_URL}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: bytes.toString("base64"), mimeType: mimeType ?? "" }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // 4xx means the engine read the request and refused the file; 5xx and
      // anything else means the engine itself is in trouble.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`OCR rejected the file (${response.status}): ${detail.slice(0, 200)}`);
      }
      throw new OcrUnavailableError(`OCR service returned ${response.status}: ${detail.slice(0, 200)}`);
    }

    const result = (await response.json()) as OcrResult;
    logger.info("ocr complete", {
      ms: Date.now() - started,
      lines: result.lines.length,
      source: result.source,
    });
    return result;
  } catch (error) {
    if (error instanceof OcrUnavailableError) throw error;

    // A refused connection or a timeout is the service being down, not a bad
    // receipt. Saying so accurately is what lets the pipeline reply honestly.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("fetch failed") ||
      message.includes("ECONNREFUSED") ||
      message.includes("aborted") ||
      message.includes("terminated")
    ) {
      throw new OcrUnavailableError(`OCR service unreachable at ${env.OCR_SERVICE_URL}: ${message}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the OCR service is up. Used at startup to warn early rather than on first receipt. */
export async function isOcrReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${env.OCR_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** All the text, top to bottom — for bank detection and the is-this-a-receipt check. */
export function plainText(result: OcrResult): string {
  return result.lines.map((line) => line.text).join("\n");
}
