# Finance App Architecture — Nigeria Expense Tracker

**Scope:** Web app first → wrapped into mobile later. Phase 1: screenshot/receipt-based expense tracking (WhatsApp bot + in-app upload). Phase 2: budgeting, savings & investment goals. *(Gmail/email scraping deferred — out of scope for now, to be designed when it's actually next up.)*

---

## 1. Guiding principles

- **One codebase, two shells.** Build a responsive web app (PWA-capable) now, wrap it with **Capacitor** later to ship as an iOS/Android app with native APIs (camera, share sheet, push notifications) — no rewrite required. This matches what you already know (React/Vite, Node/Express from Living Word) rather than introducing a second stack.
- **Ingestion is the hard part, not the dashboard.** Receipt parsing is asynchronous, error-prone, and bank-format-specific — architect it as decoupled background jobs, not request/response calls.
- **Design for Nigerian banking reality.** Alert screenshots come from GTBank, Access, Zenith, UBA, Kuda, OPay, PalmPay, Moniepoint, Chipper Cash — each with a different alert template. Your parser needs a per-source template system, not one universal regex.
- **Don't rebuild what already exists.** Nigerian open banking APIs (Mono, Okra) can pull transactions directly from linked bank accounts — this can eventually replace or supplement screenshot OCR. Worth evaluating before you over-invest in OCR accuracy.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                │
│  Web app (React/Next.js + shadcn/ui, PWA)  →  later:         │
│  Capacitor shell (iOS/Android — camera, share-sheet,         │
│  push notifications)                                          │
└───────────────┬────────────────────────────────────────────-┘
                │ REST/GraphQL (HTTPS, JWT auth)
┌───────────────▼───────────────────────────────────────────-─┐
│  API LAYER (Node.js / Express or NestJS)                     │
│  - Auth (JWT + phone OTP via Termii/Africa's Talking)        │
│  - Transactions API, Budgets API, Goals API                  │
│  - Ingestion webhook endpoints                                │
└───────┬───────────────────────────────────┬─────────────────┘
        │                                   │
   ┌────▼────────────┐              ┌───────▼──────┐
   │ Receipt ingestion │              │  Budgeting    │
   │ pipeline           │              │  & Goals      │
   │ (WhatsApp bot +    │              │  engine       │
   │ in-app upload)      │              │  (Phase 2)    │
   │ (Phase 1)          │              └───────┬──────┘
   └────┬────────────┘                          │
        │                                        │
   ┌────▼────────────────────────────────────────▼─────┐
   │  JOB QUEUE (BullMQ + Redis)                        │
   │  OCR jobs, categorization                          │
   └────┬────────────────────────────────────────────-─┘
        │
   ┌────▼─────────────────────────────────────┐
   │  DATA LAYER                                │
   │  Postgres (users, transactions, budgets,   │
   │  goals) · S3-compatible storage (images)   │
   │  · Redis (cache/session)                   │
   └─────────────────────────────────────────-─┘
```

---

## 3. Receipt ingestion (Phase 1 — the core feature)

The biggest architectural decision here is **how receipts reach the app**. The WhatsApp bot is the lead channel because it reuses a habit Nigerian bank apps already support: their built-in "Share Transaction Receipt" action.

| Channel | Friction | Build effort | Notes |
|---|---|---|---|
| **WhatsApp bot** | User taps Share → WhatsApp → your bot number, right from the bank app | Medium (WhatsApp Business API) | Lead channel — no app switch, uses an action users already know |
| **In-app upload** | User opens app, taps upload | Low | Baseline fallback for anyone without the bot linked |
| **Direct share to app** *(post mobile rollout)* | User taps Share → your app directly | Medium (native share-target plugin) | Fastest once the mobile app exists — skips WhatsApp entirely |

**Account linking:** the bot needs to know whose account a receipt belongs to. During onboarding, the user verifies the phone number they'll be messaging from (same number used for OTP auth) — that's the link between a WhatsApp sender and an app user, no extra step needed at send-time.

**WhatsApp bot flow:**

1. User shares a receipt from their bank app straight to the bot's WhatsApp number. Handle both **image and PDF** — several Nigerian bank apps (GTBank, Access, Kuda) generate a PDF receipt rather than a screenshot when you use "Share."
2. Webhook receives the message → resolves the WhatsApp media ID to a downloadable URL → downloads → stores in S3 → queues OCR job.
3. Bot replies with a confirmation ("Logged ₦12,500 to Jumia — Shopping category ✅") or, on low-confidence extraction, asks the user to confirm/correct right in the chat. This doubles as your correction UI without needing the app open.
4. Dashboard reflects the new transaction on next open (simple polling is fine at MVP scale; a WebSocket/SSE channel or a push notification — once mobile ships — makes it feel closer to real-time).

**Practical note:** WhatsApp Business API access needs Meta business verification and a dedicated number — usually easiest through a Business Solution Provider (Termii, 360dialog, Twilio) that also handles Nigerian number provisioning. Your core receipt-logging flow is user-initiated, so it falls under WhatsApp's free "service conversation" tier — cost only shows up if you later send proactive alerts outside a 24-hour reply window.

**Once the mobile app exists:** register it as a native share target — an Intent Filter on Android (`ACTION_SEND`, `image/*` and `application/pdf`), a Share Extension on iOS. Capacitor doesn't include this by default, so it's a small native plugin per platform. At that point the same "Share" button in the bank app can target your app directly, reusing the identical OCR/parser pipeline below — worth keeping the WhatsApp channel alive alongside it for users who haven't installed the app.

**Pipeline once a receipt arrives (any channel):**

1. File lands in ingestion endpoint (webhook or upload) → stored in S3-compatible bucket → job queued.
2. **OCR worker** (Google Cloud Vision or AWS Textract — both handle Nigerian bank alert screenshots reasonably well; for PDFs, extract text directly first and only fall back to OCR if the PDF has no text layer) extracts raw text.
3. **Template parser**: matches the source bank/fintech (by layout fingerprint or sender number pattern) and extracts structured fields — amount, merchant/recipient, date, transaction type, reference number. Maintain this as a per-bank template registry so adding a new bank format doesn't touch core logic.
4. **Categorization**: rule-based first pass (merchant name → category mapping), with room to layer in a lightweight ML classifier later as you accumulate labeled data.
5. **Dedup check**: hash on (amount, date, reference number) to avoid double-counting if the same receipt is somehow submitted twice (e.g. WhatsApp and in-app upload).
6. Confirmed transaction written to `transactions` table; low-confidence extractions flagged for user confirmation in-app rather than silently guessed.

---

## 4. Budgeting, savings & investment goals (Phase 2)

Once transactions are flowing reliably, this layer is mostly straightforward CRUD + calculation on top of existing data:

- **Budgets**: per-category monthly limits, computed spend-to-date from `transactions`, threshold alerts (e.g. 80% of budget).
- **Goals**: target amount + target date for savings/investment goals, progress tracked either from manually logged contributions or auto-detected transfers to a known savings account/category.
- **Planning**: projected month-end spend based on current pace — pure derived data, no new ingestion needed.

This phase benefits most from push notifications, which is a strong reason to have the mobile shell (Capacitor) in place by the time you build it.

---

## 5. Core data model (simplified)

```
users            (id, phone, email, auth_provider, created_at)
screenshots      (id, user_id, s3_key, ocr_status, raw_ocr_text)
transactions     (id, user_id, source[whatsapp|upload|manual], amount,
                  currency, merchant, category_id, occurred_at,
                  confidence_score, dedup_hash, status)
categories       (id, name, is_system_default)
budgets          (id, user_id, category_id, period, amount_limit)
goals            (id, user_id, type[saving|investment], target_amount,
                  current_amount, target_date)
notifications    (id, user_id, type, payload, sent_at)
```

---

## 6. Infrastructure & third-party services

- **Backend**: Node.js (Express or NestJS) — consistent with your Living Word stack.
- **Frontend**: React + Next.js (SSR + PWA support out of the box) with **shadcn/ui** as the component/design system (see Section 7).
- **DB**: Postgres (Supabase is a reasonable managed option if you want auth + Postgres + storage in one place early on).
- **Queue**: BullMQ + Redis for OCR jobs.
- **OCR**: Google Cloud Vision or AWS Textract.
- **SMS/OTP**: Termii or Africa's Talking (Nigerian-focused, reliable local delivery).
- **WhatsApp bot**: WhatsApp Business Platform (via Meta or a BSP like Termii/360dialog).
- **Open banking (worth evaluating later)**: Mono or Okra — Nigerian account-aggregation APIs that could eventually pull transactions directly, reducing reliance on OCR accuracy.

---

## 7. Frontend design system (shadcn/ui)

**Setup:**
```
pnpm dlx shadcn@latest init --preset b8Qy9QDHYe --template next --pointer
```
Run inside the Next.js app. This bakes in a single portable preset (colors, style, icon library, font, radius) plus `cursor: pointer` on buttons in one step. Components are plain React + Tailwind, so nothing needs to change when the app is later wrapped in Capacitor — the same component tree ships to mobile as-is.

**Core screens and the components each needs** (add per-screen with `pnpm dlx shadcn@latest add <component>`):

| Screen | Purpose | Key components |
|---|---|---|
| Onboarding / Auth | Phone verification (OTP), WhatsApp number linking | `form`, `input`, `input-otp`, `button`, `card` |
| Dashboard | Transaction feed, spend overview | `card`, `table`, `tabs`, `badge`, `avatar`, `skeleton` |
| Transaction detail / confirm | Review & correct low-confidence OCR extractions | `dialog` or `sheet`, `form`, `select` (category), `badge` (confidence indicator) |
| Budgets | Category limits, spend-to-date | `progress`, `card`, `form`, `alert` (threshold warnings) |
| Goals | Savings/investment targets | `progress`, `card`, `form`, `calendar` (target date) |
| Settings | WhatsApp linking status, notification prefs | `switch`, `card`, `separator` |
| Global | Bot-confirmation toasts, empty/error states | `sonner` (toast), `alert` |

**Why `skeleton` and `toast` matter here specifically:** receipts arrive asynchronously (WhatsApp → OCR → parse can take a few seconds), so the dashboard needs a visible "processing" state rather than transactions just appearing with no feedback — a skeleton row while a job is in flight, then a toast or highlight when it lands. This is the UI counterpart to the polling/WebSocket sync described in Section 3.

---

## 8. Security & compliance notes

- Comply with the **Nigeria Data Protection Act (NDPA, 2023)** — financial screenshots are high-sensitivity personal data.
- Encrypt screenshot/receipt images at rest; TLS everywhere in transit.
- Rate-limit and validate all inbound webhook endpoints (WhatsApp) — these are public-facing ingestion points and a common attack surface.

---

## 9. Suggested build order

1. **Phase 1 (MVP):** Auth with phone verification (doubles as WhatsApp linking), WhatsApp bot for receipt ingestion (image + PDF), in-app upload as fallback, OCR + template parser for 3–4 major banks/fintechs, manual category correction, transaction list/dashboard built on shadcn/ui. Ship as a web app (PWA).
2. **Phase 2:** Budgets, goals, planning views, push notifications.
3. **Phase 3:** Wrap with Capacitor for iOS/Android, then add the native share-target plugin so receipts can be shared directly into the app — keep the WhatsApp bot running in parallel for non-app users.
4. **Later (deferred):** Email/Gmail scraping and open banking (Mono/Okra) — revisit once the core product is validated.

---

*This is a starting architecture, not a locked spec — the ingestion channel mix (WhatsApp vs direct app share) is the piece most worth validating with real users before over-building.*
