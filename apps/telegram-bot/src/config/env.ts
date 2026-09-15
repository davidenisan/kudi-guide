import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

// Variables set in the shell win over both files. dotenv's override would
// otherwise let a checked-in file silently beat an explicit `FOO=bar npm run …`,
// which makes it impossible to try a different setting without editing the file.
const shellProvided = new Map(Object.entries(process.env));

loadEnv({ path: resolve(process.cwd(), "../../.env") });
// The app's own .env beats the repo-root one.
loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

for (const [key, value] of shellProvided) {
  if (value !== undefined) process.env[key] = value;
}

/** A var set to "" in a .env file means "not filled in yet", not "empty value". */
const blankAsUndefined = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Optional at parse time so database-only scripts run without a bot token.
  // The bot entrypoint calls requireTelegramToken() instead.
  TELEGRAM_BOT_TOKEN: blankAsUndefined,
  MONGODB_URI: blankAsUndefined.pipe(z.string().default("mongodb://127.0.0.1:27017")),
  MONGODB_DB_NAME: blankAsUndefined.pipe(z.string().default("kudi_guide_phase0")),
  SUMMARY_TIMEZONE: blankAsUndefined.pipe(z.string().default("Africa/Lagos")),

  // Local NLU. Understanding only — the model never decides an action.
  NLU_ENABLED: blankAsUndefined
    .pipe(z.enum(["true", "false"]).default("true"))
    .transform((value) => value === "true"),
  /**
   * 3B is the floor for the conversational replies. The 1.5B classifies well
   * enough, but asked to write a reply it repeats the message back verbatim and
   * occasionally emits its own prompt, which no guardrail can turn into
   * something worth sending.
   */
  NLU_MODEL_URI: blankAsUndefined.pipe(
    z.string().default("hf:Qwen/Qwen2.5-3B-Instruct-GGUF/qwen2.5-3b-instruct-q4_k_m.gguf"),
  ),
  /**
   * Private channel that failed extractions are reported to. Optional: without
   * it the bot runs normally and reports live only in the review log.
   */
  ADMIN_CHAT_ID: blankAsUndefined,

  /**
   * Discard messages that arrived while the bot was offline. Convenient in
   * development, where a restart would otherwise replay test traffic. Must be
   * false with real testers: Telegram holds undelivered messages for ~24h, and
   * dropping them means a tester's receipt silently disappears.
   */
  TELEGRAM_DROP_PENDING_UPDATES: blankAsUndefined
    .pipe(z.enum(["true", "false"]).default("false"))
    .transform((value) => value === "true"),

  /**
   * Past this, give up and fall back to the deterministic matcher.
   *
   * Generous because of one request: the warm-up, which evaluates the whole
   * system prompt cold and took over 15s on the 3B. Timing that one out is
   * self-defeating — the point of warming up is that no real message has to pay
   * for it. Once warm, a message takes 1-3s and never approaches this.
   */
  NLU_TIMEOUT_MS: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : 30000),
    z.number().int().positive(),
  ),

  /** Where the local OCR service listens. */
  OCR_SERVICE_URL: blankAsUndefined.pipe(z.string().default("http://127.0.0.1:8765")),

  /**
   * Whether this process should start the OCR service itself when
   * OCR_SERVICE_URL points at localhost and nothing answers there yet. The
   * point of it: two processes should not require two people remembering to
   * start them. False when OCR runs as its own long-lived deployment — a
   * separate container or host — that this process must not manage.
   */
  OCR_AUTOSTART: blankAsUndefined
    .pipe(z.enum(["true", "false"]).default("true"))
    .transform((value) => value === "true"),

  /**
   * A receipt takes about 4s to read. This is the ceiling before the pipeline
   * calls it a failure rather than a slow success — generous, because timing out
   * a receipt that would have worked is worse than making someone wait.
   */
  OCR_TIMEOUT_MS: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : 30000),
    z.number().int().positive(),
  ),
});

export const env = envSchema.parse(process.env);

export function requireTelegramToken(): string {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and put the token in apps/telegram-bot/.env",
    );
  }
  return env.TELEGRAM_BOT_TOKEN;
}
