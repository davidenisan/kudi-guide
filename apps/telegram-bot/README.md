# Phase 0 — Telegram-Only Expense Tracker

Implements `docs/Phase0_Telegram_MVP_Spec.pdf`. Self-contained: it does not share
a database or any code with `apps/api` / `apps/web`, which are the deferred
Phase 1+ stack.

The question this phase exists to answer: **do people who send us a receipt keep
sending receipts?**

## Understanding vs. doing

Natural-language understanding runs on a **local instruct model** (Qwen2.5-1.5B,
GGUF, via `node-llama-cpp` with Metal). No API, no key, no network at runtime.

The split is the important part:

| The model | The application |
| --- | --- |
| Reads the message | Decides what that permits |
| Emits an enum from `nlu/schema.ts` | Owns every threshold |
| Says `request_undo`, `high` | Chooses which transaction, and whether to ask first |
| Says `period: this_month` | Turns that into dates and runs the query |
| Never sees an amount | Does all arithmetic |
| Never writes user-facing text | Picks the reply |

The model's output is constrained by a **JSON schema grammar**, so it cannot emit
a value outside our enums, and every field is re-validated in code afterwards.
It has no vocabulary for "delete transaction X" — it can only say "this reads
like an undo request", and `core/understand.ts` decides what follows.

Two safety floors live in application code, not the prompt:

- Undo acts only on `high` confidence **and** a message of two or more words.
  During testing the model returned `high` for a bare "wrong", which would have
  deleted a real entry. Model confidence is never the only thing between a user
  and lost data.
- A `request_summary` the model itself calls `low` becomes `unclear`, so numbers
  are never returned for a misread question.

If the model is missing, disabled, still loading, times out, or returns
something invalid, understanding falls back to the deterministic matcher in
`core/intent/`. That matcher is **frozen** — it exists so the bot degrades
instead of breaking, not as a second system to grow. Set `NLU_ENABLED=false` to
run on it deliberately.

Measured on a 57-case corpus of the Pidgin, slang, typo and out-of-scope
messages that came out of real testing (`npm run test:nlu`):

```
local model:     60/60  (100%)
pattern matcher: 51/60  (85%)
latency: ~1.4s per message
```

Two jobs were taken *off* the model because it was measurably bad at them, and
both are surface properties of the text rather than acts of interpretation
(`core/intent/register.ts`):

- **Register.** The model labelled "hi" and "good morning" as Pidgin, so the bot
  answered "I dey here" to plain English. A short marker list gets it right
  every time.
- **Junk.** A model forced to pick an intent for `gjkl` or `....` picks one — it
  answered "spending summary" for `....`. Messages with no word-like content now
  resolve in under a millisecond without inference.

Startup runs one throwaway interpretation to put the system prompt in the KV
cache. Without it the first user message paid a 4-second penalty evaluating
~1,300 tokens of prompt. `npm run test:latency` measures both numbers.

The model also reports *why* a message didn't map to an intent —
`out_of_scope` ("I understood you, I just don't do that") versus
`not_understood` ("I didn't follow you"). Answering "did you want your spending
summary?" to a question about the weather pretends to be confused when the bot
understood perfectly well.

## Layering

Two boundaries, both from the spec, both worth defending:

- **Transport is a thin adapter.** Nothing under `src/core/` may import a
  Telegram library or see a `file_id`. Swapping Telegram for WhatsApp Cloud API
  (Section 12) should mean writing a new adapter, not touching the pipeline.
- **Storage is behind one module.** Only `src/db/` imports the MongoDB driver or
  builds a query. Everything else calls `saveTransaction()`,
  `findRecentTransaction()`, `getMonthlySummary()` and receives plain objects —
  no `ObjectId` crosses the boundary.

```
src/
  index.ts                       entrypoint — wires one adapter to one handler
  config/env.ts                  environment, validated at startup
  core/
    router.ts                    the Section 2 message router
    message.ts                   the adapter <-> core contract
    types.ts                     domain types — no transport, no driver
    time.ts                      Lagos calendar day/month boundaries
    files.ts                     hashing and magic-byte sniffing
    replies.ts                   phrasing variants (Section 3 tone)
    conversation.ts              short-lived state (pending undo confirmation)
    review-log.ts                the log of everything we couldn't handle
    intent/                      local intent classification
    handlers/                    receipt, category, summary, undo
  transport/telegram/adapter.ts  the only Telegram-aware file
  db/                            the only place MongoDB is imported
  scripts/                       setup, inspection, test harnesses
```

## Setup

MongoDB must be running locally:

```
brew services start mongodb-community
```

Then:

```
cd apps/telegram-bot
npm install
cp .env.example .env     # fill in TELEGRAM_BOT_TOKEN when you have one
npm run db:init
npm run model:fetch      # ~1.1 GB, once
```

`model:fetch` downloads the local NLU model into `models/` (gitignored). The bot
also resolves it lazily on startup, but fetching first means the first real
message isn't waiting on a download.

`db:init` creates the `users` and `transactions` collections and the Section 4
indexes. It is safe to re-run.

## Running the bot

From **this folder**:

```
npm run dev
```

Or from the **repo root**, without changing directory:

```
npm run bot
```

Long polling — no public URL, no TLS, no tunnel. Ctrl-C stops it cleanly.

> The root `npm run dev` is the old monorepo script and shells out to pnpm.
> Every Phase 0 script is available from the root prefixed with `bot:` —
> `npm run bot`, `npm run bot:test`, `npm run bot:db:stats`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the bot with reload on change |
| `npm run db:init` | Create collections + indexes, print what exists |
| `npm run db:stats` | Document counts; pass a Telegram user id for their recent rows |
| `npm run db:smoke` | Exercise every db operation against a scratch user, then clean up |
| `npm run model:fetch` | Download the local NLU model (~1.1 GB, once) |
| `npm run test:nlu` | Local model vs. frozen matcher on the 57-case corpus |
| `npm run test:latency` | Startup cost and per-message latency |
| `npm run test:intent` | Fallback matcher accuracy against a labelled corpus |
| `npm run test:router` | Drive a whole conversation through the core, no Telegram involved |
| `npm run typecheck` | `tsc --noEmit` |

## The review log

Everything the bot could not handle is appended to `storage/review/*.jsonl`:

- `unclear.jsonl` — every message that didn't map to an intent. Section 3 is
  explicit that this log is the evidence for whether pattern matching is enough
  or a local model is needed. Read it before deciding you need one.
- `rejected-receipt.jsonl` — media that never reached the pipeline.

These are files, not a third collection, per Section 4.

## Conventions

- **Amounts are integer kobo.** Never a float naira value, anywhere.
- **Ask, don't guess.** Low confidence on an amount or a category means asking
  the user, never picking the likeliest value.
- `raw_extraction_json` is stored on every transaction, including rejected ones.
  It is the debugging record for parse failures.
- The bot never volunteers commentary, advice, or warnings about spending
  (Section 3, "the line we're not crossing").
