CREATE TYPE "AuthProvider" AS ENUM ('phone', 'email', 'oauth');
CREATE TYPE "OcrStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE "TransactionSource" AS ENUM ('whatsapp', 'upload', 'manual');
CREATE TYPE "TransactionStatus" AS ENUM ('pending', 'confirmed', 'needs_review', 'duplicate');
CREATE TYPE "GoalType" AS ENUM ('saving', 'investment');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phone" TEXT,
  "email" TEXT,
  "auth_provider" "AuthProvider" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "screenshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "s3_key" TEXT NOT NULL,
  "ocr_status" "OcrStatus" NOT NULL DEFAULT 'queued',
  "raw_ocr_text" TEXT,
  CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "is_system_default" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "source" "TransactionSource" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "merchant" TEXT,
  "category_id" UUID,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "confidence_score" DOUBLE PRECISION,
  "dedup_hash" TEXT,
  "status" "TransactionStatus" NOT NULL DEFAULT 'pending',
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "budgets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "amount_limit" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "type" "GoalType" NOT NULL,
  "target_amount" DECIMAL(14,2) NOT NULL,
  "current_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "target_date" TIMESTAMP(3),
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "sent_at" TIMESTAMP(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");
CREATE UNIQUE INDEX "transactions_dedup_hash_key" ON "transactions"("dedup_hash");
CREATE UNIQUE INDEX "budgets_user_id_category_id_period_key" ON "budgets"("user_id", "category_id", "period");
CREATE INDEX "screenshots_user_id_idx" ON "screenshots"("user_id");
CREATE INDEX "transactions_user_id_occurred_at_idx" ON "transactions"("user_id", "occurred_at");
CREATE INDEX "transactions_category_id_idx" ON "transactions"("category_id");
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id");
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
