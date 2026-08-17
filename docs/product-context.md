# Product Context

This product context is derived from:

- `finance-app-architecture.md`
- `Nigeria-Expense-Tracker-User-Flows-Stories-2.docx`

It should guide implementation decisions for the Nigerian expense tracker.

## Current Product Shape

Kudi Guide is a Nigerian expense-tracking app built web-first, with a later Capacitor mobile wrapper. Phase 1 centers on receipt ingestion from WhatsApp and in-app uploads. Phase 2 adds budgets, goals, projections, and alerts. Phase 3 adds mobile push notifications and native share-target support.

There is one primary user persona: an app user identified by a verified phone number. That phone number is used for OTP login and also becomes the WhatsApp sender identity. There is no separate admin or business-owner persona in the current product scope.

## Phase 1 Priorities

The lead ingestion channel is WhatsApp. Users share bank receipts from Nigerian banks and fintech apps to a WhatsApp Business number. In-app image/PDF upload is the fallback channel. Both channels feed the same backend pipeline:

1. Receive image or PDF receipt.
2. Store the file in S3-compatible storage.
3. Queue OCR/parser work with BullMQ and Redis.
4. Extract text from images, or read PDF text layers before falling back to OCR.
5. Parse receipt fields using a per-bank/fintech template registry.
6. Categorize with rule-based tagging.
7. Deduplicate by hashing amount, date, and reference number.
8. Write or update the transaction.

Supported early receipt sources should include major Nigerian banks and fintechs such as GTBank, Access, Zenith, UBA, Kuda, OPay, PalmPay, Moniepoint, and Chipper Cash. MVP parser work should start with 3-4 high-volume sources.

## Confirmation Model

The product intentionally confirms categories, not every extracted field.

Amount, merchant/recipient, date, transaction type, and reference number are treated as extracted transaction facts. If the system is unsure, the user is asked to confirm or correct the category only. This applies in WhatsApp and in the web app.

Low-confidence category confirmations should appear:

- In WhatsApp, as an in-chat correction request.
- In the web app, as a transaction detail dialog or sheet with a category select and confidence badge.

The confidence badge is scoped to category assignment, not to the entire transaction.

## Category Direction

The original seed categories are the foundation, but the user-flow document gives stronger categorization direction for Phase 1:

- Savings/investment platforms such as Cowrywise and PiggyVest map to savings/investing.
- Telcos such as MTN and Airtel map to data/airtime.
- Recipients sharing the user's surname, or previously tagged as family, map to family.
- Restaurants map to food.
- Supermarkets and stores map to shopping.
- Unknown matches should suggest a new tag when possible, then fall back to Other.

Future schema and seed updates should consider whether to expand the initial system categories beyond the original minimal seed.

## Dashboard Expectations

The dashboard should show a spend overview and transaction feed using tables/cards, tabs, badges, avatars, skeleton loading states, and toast notifications.

Receipt processing is asynchronous, so the UI should never feel like a silent delay. While a receipt is being parsed, show a skeleton row or processing state. When the transaction lands, show a toast or highlight. At MVP scale, refresh can happen on next app open or simple polling; realtime updates can come later via WebSocket/SSE or mobile push.

## Phase 2 Expectations

Budgets are category-based monthly limits. Spend-to-date should be computed from the `transactions` table, not a separate ledger. Budget threshold alerts should trigger at a configurable threshold, such as 80%.

Goals support saving and investment targets. Goal progress can come from manual contributions or auto-detected transfers to known savings/investment accounts or categories. Month-end spend projection is derived from existing transactions only.

## Phase 3 Expectations

Capacitor should wrap the existing Next.js/shadcn component tree without a rewrite. The mobile app later adds native APIs:

- Camera
- Share sheet/share target
- Push notifications

Native share-target support should accept `image/*` and `application/pdf` and feed the same OCR/parser/categorization/dedup pipeline. WhatsApp remains available after mobile launch and is not replaced.

## Security And Compliance

Receipts and financial screenshots are sensitive personal data. Product work should account for:

- Nigeria Data Protection Act compliance.
- Encryption at rest for receipt images.
- TLS in transit.
- Rate limiting and payload validation for public webhook endpoints.

## Explicitly Out Of Scope

These are intentionally deferred:

- Gmail/email scraping.
- Open banking integrations such as Mono or Okra.
