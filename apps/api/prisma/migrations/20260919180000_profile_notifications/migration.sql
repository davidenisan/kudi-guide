ALTER TABLE "users" ADD COLUMN "nickname" TEXT, ADD COLUMN "transaction_alerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notifications" ADD COLUMN "read_at" TIMESTAMP(3);
