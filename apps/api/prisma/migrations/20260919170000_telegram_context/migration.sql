CREATE TABLE "telegram_conversations" (
  "user_id" UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "state" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "telegram_turns" (
  "key" TEXT PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reply" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "telegram_turns_user_id_idx" ON "telegram_turns"("user_id");
