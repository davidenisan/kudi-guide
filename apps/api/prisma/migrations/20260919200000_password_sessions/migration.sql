ALTER TABLE "users" ADD COLUMN "username" TEXT, ADD COLUMN "password_hash" TEXT;
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE TABLE "sessions" (
 "token_hash" TEXT NOT NULL PRIMARY KEY,
 "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "expires_at" TIMESTAMP(3) NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
