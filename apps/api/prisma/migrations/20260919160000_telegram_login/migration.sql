CREATE TABLE "telegram_logins" (
  "code" TEXT PRIMARY KEY,
  "verifier_hash" TEXT NOT NULL,
  "chat_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL
);
