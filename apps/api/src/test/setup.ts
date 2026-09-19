// Tests never inherit real bot credentials or depend on the developer's .env.
Object.assign(process.env, {
 NODE_ENV: "test", JWT_SECRET: "test-secret-that-is-long-enough-for-jwt-signing", JWT_ACCESS_TOKEN_TTL: "15m",
 DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/kudi_guide_test", REDIS_URL: "redis://localhost:6379",
 API_CORS_ORIGIN: "http://localhost:3000", PHONE_SIGNIN_ENABLED: "true", TELEGRAM_BOT_TOKEN: "test-only", TELEGRAM_WEBHOOK_SECRET: "test-only",
 S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_BUCKET: "test", LLM_ENABLED: "false",
});
