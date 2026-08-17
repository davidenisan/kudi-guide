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

Phone OTP auth is available at `/onboarding`. The web app calls same-origin Next.js auth routes, which proxy to the API and store the JWT in an httpOnly `kg_access_token` cookie after OTP verification.

The API integrates SMS through a small provider interface. Set `TERMII_API_KEY` and `TERMII_SENDER_ID` to send real OTP messages with Termii. If no Termii key is configured, the API logs OTPs to the console for local development.

## Staging Requirements

A staging environment needs:

- A managed Postgres database and `DATABASE_URL`
- A Redis instance and `REDIS_URL`
- An S3-compatible bucket plus region, endpoint, credentials, and bucket name
- API deployment with `PORT`, `NODE_ENV`, and `API_CORS_ORIGIN`
- Web deployment with `NEXT_PUBLIC_API_URL`

OCR, WhatsApp ingestion, authentication, and real upload flows are intentionally left for Phase 1.

## Product Context

Implementation should follow the product flows and story decisions captured in `docs/product-context.md`, derived from the architecture document and user-flow DOCX.
