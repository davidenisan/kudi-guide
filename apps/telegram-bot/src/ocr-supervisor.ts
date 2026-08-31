import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./config/env.js";
import { isOcrReachable } from "./core/receipt/ocr-client.js";
import { logger } from "./logger.js";

/**
 * Starts and supervises the local OCR process, when it is this machine's job
 * to have one running.
 *
 * The failure this exists to prevent: a receipt sent while nobody remembered
 * that `ocr/run.sh` needs its own terminal, forever, on every restart. The bot
 * and the OCR service are two processes in two languages (Section 5's own
 * constraint — PaddleOCR is Python), but "two processes" does not have to mean
 * "two things a person has to remember to start." One command should be enough
 * when they are meant to live on the same machine.
 *
 * It stays optional in the direction that matters: OCR_SERVICE_URL pointing
 * anywhere other than localhost — a separate container, a different host —
 * means there is nothing here to start, and this module does nothing. That is
 * the seam the "run it either way" decision back in step 4 was for.
 */

const START_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

let child: ChildProcess | null = null;

function isLocalTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Brings the OCR service up if it is this bot's responsibility and it is not
 * already reachable. Never throws — a failure here is reported and left for
 * the existing per-receipt handling to surface, the same as before this
 * existed. It does not make extraction any less resilient; it just means
 * fewer restarts actually need that resilience.
 */
export async function ensureOcrService(): Promise<void> {
  if (!env.OCR_AUTOSTART) {
    logger.info("OCR autostart disabled — expecting the service to be started separately");
    return;
  }

  if (!isLocalTarget(env.OCR_SERVICE_URL)) {
    logger.info("OCR_SERVICE_URL is not local — nothing for this process to start", {
      url: env.OCR_SERVICE_URL,
    });
    return;
  }

  if (await isOcrReachable()) {
    logger.info("OCR service already running");
    return;
  }

  const scriptPath = resolve(process.cwd(), "ocr", "run.sh");
  const venvPath = resolve(process.cwd(), "ocr", ".venv");

  if (!existsSync(scriptPath) || !existsSync(venvPath)) {
    logger.warn(
      "OCR service not running and no local install found to start — receipts will fail until one is set up",
      { hint: "see apps/telegram-bot/ocr/README.md", scriptPath },
    );
    return;
  }

  logger.info("starting OCR service", { scriptPath });

  child = spawn(scriptPath, [], {
    cwd: resolve(process.cwd(), "ocr"),
    stdio: ["ignore", "pipe", "pipe"],
  });

  // The models take real time to load (Section 5), so this output is the only
  // sign of life for up to a minute. Prefixed and routed through the same
  // logger as everything else, so a slow or failed load shows up where whoever
  // is watching the bot's logs will actually see it.
  child.stdout?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim()) logger.info(`[ocr] ${line.trim()}`);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim()) logger.warn(`[ocr] ${line.trim()}`);
    }
  });
  child.on("exit", (code, signal) => {
    if (child !== null) {
      // Still owned by us and it went away unexpectedly — worth knowing loudly,
      // since every receipt from here on will fail until something notices.
      logger.error("OCR service exited unexpectedly", { code, signal });
    }
    child = null;
  });

  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await isOcrReachable()) {
      logger.info("OCR service ready", { ms: Date.now() - started });
      return;
    }
    await new Promise((done) => setTimeout(done, POLL_INTERVAL_MS));
  }

  logger.warn("OCR service did not become reachable in time — continuing without it", {
    waitedMs: START_TIMEOUT_MS,
  });
}

/** Stops the OCR process if this bot started one. Safe to call unconditionally. */
export function stopOcrService(): void {
  if (!child) return;
  const toKill = child;
  child = null; // Cleared first so the exit handler above does not log it as a crash.
  toKill.kill("SIGTERM");
  logger.info("stopped OCR service");
}
