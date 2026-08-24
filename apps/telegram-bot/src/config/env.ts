import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

loadEnv({ path: resolve(process.cwd(), "../../.env") });
loadEnv({ path: resolve(process.cwd(), ".env"), override: true });

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
  NLU_MODEL_URI: blankAsUndefined.pipe(
    z.string().default("hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF/qwen2.5-1.5b-instruct-q4_k_m.gguf"),
  ),
  /**
   * Discard messages that arrived while the bot was offline. Convenient in
   * development, where a restart would otherwise replay test traffic. Must be
   * false with real testers: Telegram holds undelivered messages for ~24h, and
   * dropping them means a tester's receipt silently disappears.
   */
  TELEGRAM_DROP_PENDING_UPDATES: blankAsUndefined
    .pipe(z.enum(["true", "false"]).default("false"))
    .transform((value) => value === "true"),

  /** Past this, give up and fall back to the deterministic matcher. */
  NLU_TIMEOUT_MS: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : 15000),
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
