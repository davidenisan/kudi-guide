# Kudi Guide

Foundation for a Nigerian expense-tracking app: Next.js web app, Express API, shared TypeScript types, Postgres via Prisma, Redis/BullMQ jobs, and S3-compatible storage wiring.

## Prerequisites

- Node.js 22+
- pnpm 11+
- Postgres
- Redis
- S3-compatible bucket or local MinIO

## Setup

```bash
pnpm install
cp .env.example .env
pnpm --filter api db:migrate
pnpm --filter api db:seed
```

## Run Locally

```bash
pnpm --filter web dev
pnpm --filter api dev
```

- Web: http://localhost:3000
- API health check: http://localhost:4000/health

## Database

Prisma lives in `apps/api/prisma/schema.prisma`.

```bash
pnpm --filter api db:migrate
pnpm --filter api db:seed
pnpm --filter api prisma studio
```

The seed script creates default categories for the MVP, including the original baseline set plus Phase 1 rule-tagging categories such as Savings & Investing, Data & Airtime, and Family.

## Authentication

Telegram sign-in is available at `/onboarding`. The web app uses same-origin auth routes and stores the JWT in an httpOnly `kg_access_token` cookie after approval in the bot. The older phone OTP API remains available when `PHONE_SIGNIN_ENABLED=true`.

The API integrates SMS through a small provider interface. Set `TERMII_API_KEY` and `TERMII_SENDER_ID` to send real OTP messages with Termii. If no Termii key is configured, the API logs OTPs to the console for local development.

## Staging Requirements

A staging environment needs:

- A managed Postgres database and `DATABASE_URL`
- A Redis instance and `REDIS_URL`
- An S3-compatible bucket plus region, endpoint, credentials, and bucket name
- API deployment with `PORT`, `NODE_ENV`, and `API_CORS_ORIGIN`
- Web deployment with `NEXT_PUBLIC_API_URL`

Telegram accepts natural-language expenses and JPEG/PNG/WebP/PDF receipts. Browser file upload is not implemented; send receipts to the bot.

## Product Context

Implementation should follow the product flows and story decisions captured in `docs/product-context.md`, derived from the architecture document and user-flow DOCX.

## Telegram and desktop app

Visit `/onboarding` to create an account with a display name, username, email and password (12–128 characters). Log in with either username or email plus password. Signup populates the dashboard greeting automatically; Settings lets you update the display name and username. After signup, `/connections` offers optional Telegram linking and a way to continue to the dashboard.

Public onboarding offers email/username and password login only. Existing authenticated legacy accounts can finish adding credentials in Settings.

Set `TELEGRAM_BOT_TOKEN` in the root `.env` to the BotFather token for @KudiPalBot. Never put it in a `NEXT_PUBLIC_` variable. From Connections or Settings, choose **Connect Telegram**, open the bot and tap **Start**. Telegram is a separate expense-logging connection, not the normal app login.

The API maintains a long-polling connection while it runs (one API consumer per bot). No public tunnel is required. An existing Telegram webhook must be removed before using polling. Account links persist in Postgres; the dashboard and connection status refresh every five seconds. A linked account is displayed as active only while the bot connection is healthy. Stopping the API or putting the computer to sleep stops ingestion until it resumes. This is a local service, not a deployed always-on host.

Password logins issue random 30-day sessions stored as SHA-256 hashes in Postgres. The raw token stays in a persistent HttpOnly, SameSite=Lax browser cookie (Secure in production). Refreshing or restarting the browser preserves the session; logout revokes it on the server. Passwords use salted Node scrypt hashes. Credential endpoints have bounded per-process rate limiting for the single-API local deployment; use a shared limiter before scaling to multiple instances. Email verification and password-reset email delivery are not implemented.

Legacy Telegram setup challenges expire after ten minutes, are consumed once, and require a separate browser verifier stored in an HttpOnly cookie. The Telegram link never contains that verifier. Verification grants a 15-minute legacy session to finish setting up credentials; successful setup replaces it with the persistent session.

`./apps/api/node_modules/.bin/tsx scripts/check-account-flow.mts` exercises the running web/API/database signup, login, session persistence and revocation, profile edits and legacy migration using disposable synthetic accounts. It sends no Telegram messages and removes its test users afterward.

The dashboard period selector updates Naira totals and categories for today, the last seven days, this month, this year or all time. Its Naira expenses link opens the matching filtered Transactions page. Transactions are ordered newest first and display their date and time. Appearance and the Connections entry are in Settings; the account footer opens a logout popup. Preview routes have been removed. Profiles, notification preferences and read states remain account-backed.

Local database note: the existing Docker database volume is now served by `kudi-guide-postgres-5433` on `127.0.0.1:5433` to avoid another PostgreSQL instance on port 5432. Start it with `docker start kudi-guide-postgres-5433 kudi-guide-redis`. Do not run the old `kudi-guide-postgres` container simultaneously because both use the same database volume.

To check a production build without interrupting the dev server: `NEXT_BUILD_DIR=.next-build npm run build` from `apps/web`.

## Local AI and receipt recognition

KudiPal uses **Qwen3 4B** (Apache 2.0, approximately 2.5 GB, via Ollama) for intent and context, **Tesseract** for local image OCR, **Poppler** for PDF text extraction and scanned-page rendering, and Sharp for bounded image resizing. No hosted LLM API or paid key is needed.

On macOS:

```bash
brew install ollama poppler tesseract
brew services start ollama
ollama pull qwen3:4b
pnpm --filter api prisma generate
pnpm --filter api prisma migrate deploy
```

Linux OCR dependencies: `sudo apt-get install tesseract-ocr poppler-utils`. Install Ollama separately from its official distribution, then pull the same model. See `.env.example` for `OLLAMA_URL`, `OLLAMA_MODEL`, timeouts and executable path overrides. The default URL is loopback; keep it local if receipts should stay on this machine. Settings shows whether the model is available. Model inference typically takes a few seconds after warming up; OCR adds processing time.

Try these messages:

- `Spenk 4k on Suya` → NGN 4,000, Food. Shorthand arithmetic is expanded and validated outside the model.
- `actually 5k` → updates the last expense immediately without creating a duplicate.
- `how much did I spend today?` or `/summary today`, `/summary week`, `/summary month` → deterministic totals from the authenticated account, separately by currency, with Lagos date boundaries.
- `/last` → shows the latest expense and selects it for a contextual correction.
- Send a receipt photo or PDF → extracts and saves the expense directly. Transfer receipts use the recipient or beneficiary as the transaction name, with Transfers as the category when the purpose is unknown.
- `/help` → lists the supported commands.

Receipts are limited to **10 MB and 5 PDF pages**, one expense receipt at a time. PDF text is extracted per page, with OCR for scanned pages. Password-protected, unreadable, oversized and unsupported files produce a useful error instead of an invented transaction. Document contents can only propose expenses, never issue commands. Complete receipts and corrections save immediately, with a concise saved summary. Missing or ambiguous details still trigger a clarification; no amount or recipient is invented. Categories remain editable in the dashboard.

Recent conversation context and pending drafts persist in Postgres for a 30-minute conversational window. Transaction changes and processed-turn replies commit together for replay protection. Temporary source images/PDFs are removed after extraction. The database retains only short conversation snippets, draft fields and replies; it does not retain the original receipt file. Telegram itself retains messages according to its own behavior.

A single BullMQ worker processes queued Telegram messages in order while the polling connection stays responsive during OCR/inference. Redis must be running; enable Redis persistence for deployments that need to survive Redis restarts. A failed job asks the user to resend. Existing turn IDs prevent reapplying already-committed changes. When the model is unavailable, simple text expenses and explicit commands still work, while complex interpretation asks the user to retry.

Validation:

```bash
pnpm --filter api test
# Real local model + synthetic OCR fixtures, with no transactions saved:
./apps/api/node_modules/.bin/tsx scripts/check-local-assistant.mts
# Full model/database flow using a temporary account, removed in finally:
./apps/api/node_modules/.bin/tsx scripts/check-bot-flow.mts
```

The automated OCR tests require Tesseract and Poppler; the unit suite does not require Ollama or real bot credentials. Live smoke tests do require Ollama; the database flow additionally requires the local Postgres database.

## Hosting and deployment

See [the deployment walkthrough](docs/deployment.md) for the single-server Docker setup, HTTPS, model installation, migration of existing accounts/Telegram links, backups and the launch checks. Nothing has been published automatically.

Run `./apps/api/node_modules/.bin/tsx scripts/check-transfer-receipts.mts` to exercise synthetic image, PDF and scanned-PDF transfers through OCR, local inference and direct database saving. It removes its temporary user and sends no Telegram messages.
