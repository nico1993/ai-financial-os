# Personal Financial OS — Session Context Handoff

**How to use this file:** Paste or upload this entire document into a new Claude conversation. It contains the full project context, architecture decisions, and open items from a prior planning session, so the new conversation can continue where this one left off without re-deriving anything.

---

## Project Summary

Building a self-hosted, automated personal finance engine called "Personal Financial OS." Goal: private, high-performance system that automates bank data ingestion (via Plaid) and provides deep financial insights/dashboards.

- **This is a solo project** — one user (Nico), not a product being sold or built for multiple tenants. Architectural choices should favor simplicity and low operational overhead over scalability.
- **Current phase scope:** Data Ingestion + Analytics/Dashboards only.
- **Explicitly excluded from this phase:** budgeting math (burn-rate, allowance logic).
- **Status:** Phase 1 (architecture & planning). No code has been written yet. The strategic proposal below was reviewed and refined interactively; several open questions were resolved during the discussion (see "Decisions Made" section).

---

## Full Architecture Proposal (current, approved state)

# Personal Financial OS — Phase 1 Strategic Proposal
### Data Ingestion & Analytics Architecture

**Scope:** Automated Plaid ingestion + analytics/dashboards. Budgeting math (burn-rate, allowances) explicitly deferred.

---

## 1. Executive Summary

The core architectural bet is to treat this system as an **event-sourced ledger with a derived read model**, not a simple CRUD app over a `transactions` table. Plaid's `/transactions/sync` endpoint is itself a change-stream (added/modified/removed), so the ingestion layer should be built around that abstraction from day one rather than bolted on later.

Five decisions anchor everything else:

1. **BullMQ + Redis as the sync orchestrator**, with one queue for Plaid webhooks/polling and a separate queue for categorization, so a slow LLM call never blocks transaction ingestion.
2. **A 4-tier categorization pipeline implemented as a single BullMQ flow (parent/child jobs)**, where each tier is a discrete job type that can be retried, monitored, and cost-audited independently.
3. **Raw payloads stored immutably, cleaned/normalized documents stored separately**, linked by a stable `providerTransactionId`. This gives you replay-ability if your categorization logic or schema changes later.
4. **MongoDB schemas denormalized for time-series read performance**, with compound indexes built around the actual dashboard queries (net worth over time, monthly cash flow, category breakdown) rather than a generic index-everything approach.
5. **Docker Compose as the deployment unit from the start**, with secrets, encryption keys, and Plaid credentials treated as first-class infrastructure concerns, not app config.

---

## 2. Data Ingestion Architecture

### 2.1 Provider Abstraction Layer

Plaid is the only provider for Phase 1, but the ingestion and categorization pipeline should never call the Plaid SDK directly — it should call a `FinancialProvider` interface, with `providers/plaid/PlaidProvider.ts` as the sole implementation for now:

```
interface FinancialProvider {
  createConnection(publicToken): Promise<ConnectionResult>
  syncTransactions(connection, cursor): Promise<{ added, modified, removed, nextCursor, hasMore }>
  getAccounts(connection): Promise<NormalizedAccount[]>
  verifyWebhook(req): boolean
}
```

The "Plaid Item" concept is renamed to the provider-neutral **`Connection`** everywhere in the app layer (jobs, routes, UI) — Plaid-specific naming (`itemId`, `plaid_error`) stays inside the adapter only. This is cheap to do now, while there's no code yet, and expensive to retrofit later since it touches schema field names and every query that filters by item/account. It's intentionally lightweight for a solo project: no dynamic plugin loading, no attempt to support multiple providers simultaneously — just enough indirection that a second provider (a different aggregator, or a manual CSV-import "provider") means writing a new adapter, not touching the sync or categorization pipeline.

### 2.2 Plaid `/transactions/sync` + BullMQ/Redis

Plaid's sync endpoint is cursor-based: you send a `cursor` (empty on first call), get back `added`, `modified`, `removed` arrays plus `has_more` and a `next_cursor`. The worker's job is to drain that cursor to completion on every trigger, not just fetch once.

Recommended queue structure:

- **`provider-sync` queue** — one job per `connectionId` (a `Connection` roughly maps to one linked bank login; today that's always a Plaid Item under the hood). Triggered by (a) provider webhooks (Plaid's `SYNC_UPDATES_AVAILABLE`), and (b) a scheduled BullMQ repeatable job as a fallback safety net (e.g., every 4–6 hours) in case a webhook is missed.
- **Job body** contains only `{ connectionId }` — the job handler loads the current cursor from the `Connections` collection at execution time, not at enqueue time, and resolves the right `FinancialProvider` adapter from the connection's `provider` field. This avoids stale-cursor bugs if multiple sync jobs for the same connection get queued back to back.
- **Idempotency lock**: use a Redis lock (or BullMQ's built-in job-id deduplication, e.g. `jobId: `sync:${connectionId}`` with `removeOnComplete`) so a webhook retry and a scheduled poll for the same connection can't run concurrently and race on the cursor.
- **Pagination loop inside the job**: while `has_more` is true, keep calling sync with the returned `next_cursor`, persisting the cursor to the DB after each page (not just at the end) so a crash mid-pagination resumes cleanly rather than reprocessing from scratch.
- **Rate limits**: Plaid enforces per-Item and per-client rate limits. Use BullMQ's `limiter` option on the queue (e.g., max N jobs per second) rather than ad hoc `setTimeout` throttling, and treat `429`s as retryable with exponential backoff (BullMQ's built-in `attempts` + `backoff` job options).
- **On completion**, the sync job enqueues categorization jobs (one per new/modified transaction, or batched) into a separate queue — keeping ingestion throughput decoupled from categorization latency.

### 2.3 The 4-Tier Categorization Pipeline

Model this as a **BullMQ Flow**: a parent "categorize transaction" job with a chain of child job types, where each tier either resolves the category (short-circuiting later tiers) or falls through.

- **Tier 1 — Exact Match (static).** A synchronous lookup against a `MerchantRules` collection keyed on Plaid's cleaned merchant name / `personal_finance_category` or your own normalized merchant string. This should run **inline in the sync job itself**, not as a separate queued job — it's a cheap DB read and doesn't need queue overhead. Maybe 60–80% of recurring transactions (subscriptions, known payroll, known utilities) resolve here instantly.
- **Tier 2 — Regex/Fuzzy (user-defined).** User-authored rules (e.g., "if description matches `/UBER \*TRIP/i` → Transportation"). Also inline/synchronous — regex evaluation against a small rule list is fast. Store rules with a `priority` field so users can order overlapping rules deterministically. This is also where you'd apply fuzzy matching (Levenshtein/trigram) against previously-categorized merchants the user has manually corrected before, effectively "learning" from Tier 4 corrections.
- **Tier 3 — LLM Inference (async, queued).** Only transactions that fall through Tiers 1–2 get queued into a `categorize-llm` queue. Batch these (e.g., 20–50 transactions per OpenAI call) using structured JSON output (function calling / JSON schema mode) to minimize per-call overhead and cost. This queue should have its own concurrency limit and rate limiter independent of the Plaid sync queue, since OpenAI has its own rate limits and cost profile. Cache LLM decisions back into the Tier 1 exact-match table keyed on the normalized merchant string — this is the mechanism by which Tier 3 usage should shrink over time as the exact-match table absorbs prior LLM decisions.
- **Tier 4 — Human-in-the-loop.** Anything the LLM returns with low confidence (you should require a `confidence` field in the structured output) or explicitly flags as `uncertain`, plus anything the user manually recategorizes, lands in a `needs_review` status on the transaction. This is a dashboard queue, not a background job — it's UI-driven. Crucially, a manual correction here should write back into the Tier 1/Tier 2 rule tables, closing the loop so the same merchant never needs LLM inference again.

The efficiency argument for separating these into distinct tiers isn't just cost (LLM calls are the expensive path) — it's also that Tiers 1–2 are deterministic and auditable, which matters a lot for a financial system where a user will eventually ask "why was this categorized as X."

### 2.4 Transfer Matching (Cross-Account Reconciliation)

Plaid does not link the two sides of a transfer between your own accounts — there's no `transaction_id` relationship connecting, say, a "Transfer to Savings" debit in checking with the corresponding credit in savings, or a credit-card payment leaving checking with the payment landing on the card. All Plaid gives you is a signal, via `personal_finance_category` (`TRANSFER_IN` / `TRANSFER_OUT`, or detailed values like `TRANSFER_OUT_ACCOUNT_TRANSFER`, `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`) — it flags "this is probably a transfer," not who its counterpart is. This is the reconciliation currently done by hand (e.g., in Spendee).

Add a **transfer-matching pass** as a queued job that runs after categorization completes for a sync batch:

- Scope the search to the user's own accounts (never cross-user).
- Candidate pairs: opposite-signed transactions with equal (or near-equal, to allow for a fee) magnitude, where at least one side has a `TRANSFER_*` or payment-type category, and dates fall within a small tolerance window (a few days — ACH transfers commonly settle 1–3 days apart across accounts).
- On a match, link both sides via a shared `transferGroupId` and set `excludeFromCashFlow: true` on both — this is the critical part, since an unflagged internal transfer otherwise counts as both income and an expense and inflates every cash-flow chart in section 4.
- Unmatched `TRANSFER_*`-categorized transactions age into the Tier 4 review queue after a short window (e.g., 3 days with no match found), rather than sitting silently unresolved — the user can confirm it's an external transfer (leave as-is) or manually pair it.
- This pass emits the same "affected date range" signal used by the sync job (see section 4.4) so any rollup that already included the now-reclassified transactions gets recomputed.

---

## 3. Data Modeling & Performance

### 3.1 Raw vs. Cleaned Data

Store two collections per data type: `RawPlaidTransactions` (or a generic `RawPayloads` collection with a `source`/`type` discriminator) holding the untouched Plaid response, and `Transactions` holding your normalized, app-facing document. Link them via `providerTransactionId` (Plaid's `transaction_id`), not by MongoDB `_id`.

Reasons this matters more here than in a typical CRUD app:

- **Auditability** — if a user disputes a categorization or a balance looks wrong, you need to be able to show "here's exactly what the bank sent us."
- **Replay-ability** — if you change your categorization logic, normalization rules, or schema six months from now, you can reprocess `RawPlaidTransactions` into a new `Transactions` collection without re-hitting Plaid's API (which has both rate limits and a cost per Item).
- **Plaid data corrections** — Plaid itself sometimes retroactively modifies a `pending` transaction into a `posted` one with a different `transaction_id` (pending→posted linkage via `pending_transaction_id`). Keeping the raw record lets you reconcile this cleanly rather than ending up with duplicate cleaned transactions.

Raw payloads can be a simple insert-only collection (no updates), which keeps write patterns cheap. Cleaned `Transactions` documents are the ones your indexes and queries are built around.

### 3.2 Schema Design for Time-Series Aggregation

```
Connection {          // was "Item" — provider-neutral connection record
  _id
  userId
  provider          // 'plaid' (only value today; future-proofs for a 2nd provider)
  providerItemId     // Plaid's item_id, opaque to the rest of the app
  institutionName
  status             // 'active' | 'login_required' | 'error'
  cursor             // provider sync cursor, lives here not on a separate table
  lastSyncedAt
}

Account {
  _id
  userId
  connectionId        // ref -> Connection
  provider
  providerAccountId    // Plaid's account_id
  institutionName
  type          // depository, credit, loan, investment
  subtype
  officialName
  currentBalance
  availableBalance
  isoCurrencyCode
}

Transaction {
  _id
  userId
  accountId          // ref -> Account
  providerTransactionId   // Plaid transaction_id, unique index
  pendingTransactionId    // for pending->posted reconciliation
  date                // posted date, stored as UTC Date, NOT string
  authorizedDate
  amount              // stored as integer cents, never float
  isoCurrencyCode
  merchantName        // Plaid's cleaned name
  merchantNameNormalized  // your normalized/lowercased key for Tier 1 lookups
  description          // raw description, for fuzzy/regex matching
  category: {
    tier: 1 | 2 | 3 | 4,
    value: String,       // e.g. "Groceries"
    confidence: Number,  // for LLM tier
    status: 'confirmed' | 'needs_review'
  }
  transferGroupId      // set by the transfer-matching pass (section 2.4); links both sides
  excludeFromCashFlow  // true once matched as an internal transfer; filtered out of income/expense rollups
  pending: Boolean
  isRemoved: Boolean     // soft-delete flag for Plaid "removed" events
  createdAt, updatedAt
}
```

Key modeling decisions worth calling out: amounts as **integer cents**, not floats or Decimal128 unless you specifically need sub-cent precision (you don't, for a personal finance tool) — this avoids floating point drift in aggregation pipelines. Dates as native `Date` objects in UTC, with timezone conversion happening at the presentation layer, so `$dateTrunc`/`$group` by month work correctly in aggregation without string parsing.

**Indexes** to support the dashboard's actual query patterns:

- `{ userId: 1, date: -1 }` — the workhorse index; almost every dashboard query filters by user and sorts/ranges by date.
- `{ userId: 1, 'category.value': 1, date: -1 }` — for categorical spending distribution and category drill-downs.
- `{ providerTransactionId: 1 }` unique — for upsert-on-sync idempotency (this is what makes Plaid's added/modified/removed events safe to apply as upserts).
- `{ accountId: 1, date: -1 }` — for per-account views and net worth reconciliation.
- `{ userId: 1, 'category.status': 1 }` — for the Tier 4 review queue.
- `{ transferGroupId: 1 }` sparse — for looking up both sides of a matched transfer.

For net worth and monthly cash flow, don't recompute from raw transactions on every dashboard load — use MongoDB's `$merge`/scheduled aggregation into a pre-computed `DailyBalanceSnapshot` or `MonthlyRollup` collection (populated by a nightly or post-sync job), and have the dashboard read from that. This is the standard time-series pattern: write-time aggregation for anything that gets read on every page load, on-demand aggregation only for ad hoc/drill-down queries.

### 3.3 Persistence Layer / Database Abstraction

Mongo was chosen specifically for its aggregation pipeline (`$dateTrunc`, `$merge`, compound indexes) and denormalized document shape — that choice doesn't disappear behind an abstraction, and a genuinely backend-agnostic query layer is over-engineering for a one-user system. What's still worth doing: put every persistence operation behind a **repository per aggregate** (`ConnectionRepository`, `AccountRepository`, `TransactionRepository`, `RollupRepository`), with domain-shaped method names — `upsertFromSync()`, `findByUserAndDateRange()`, `getMonthlyRollup(userId, range)` — rather than exposing the native driver or generic CRUD to routes and job handlers. This keeps intent readable regardless of backing store, and it means a future relational migration is contained to rewriting repository internals and the rollup jobs, rather than a rewrite scattered through the whole app. It won't make such a migration painless — the aggregation-pipeline logic and document shape are still Mongo-specific and would need real redesign for a relational schema — but it bounds the blast radius.

---

## 4. Analytics & Visualization Strategy

### 4.1 Frontend Structure (Vite + React SPA + TS + Shadcn)

Organize the "Financial Control Center" around **query-scoped panels**, not a monolithic dashboard component, inside the `apps/web` Vite SPA (see section 7 for the full repo layout):

```
/apps/web/src
  /routes                (React Router route components — one per dashboard page)
    net-worth.tsx
    cash-flow.tsx
    spending-categories.tsx
    subscriptions.tsx
    review-queue.tsx
  /features
    /net-worth        (NetWorthChart, useNetWorthQuery)
    /cash-flow         (CashFlowChart, useCashFlowQuery)
    /spending-categories (CategoryDonut, useCategoryBreakdown)
    /subscriptions      (SubscriptionTable, useRecurringQuery)
    /review-queue       (Tier4ReviewList)
  /components/ui        (shadcn primitives)
  /lib/api              (typed fetch client, one function per dashboard endpoint, hitting apps/api)
  /lib/events            (SSE client, section 4.3)
```

Each feature owns its own data hook (React Query / TanStack Query strongly recommended here — it gives you caching, background refetch on sync completion, and loading/error states for free, which matters a lot when the backing data updates asynchronously via BullMQ jobs the frontend didn't trigger). Use Shadcn's `Card`, `Tabs`, and `DataTable` primitives as the layout scaffolding rather than custom-building dashboard chrome. Since it's a private single-user dashboard behind auth, there's no need for SSR/SSG — a plain client-rendered SPA is simpler and there's nothing to gain from server rendering here.

### 4.2 Serving Data to Recharts/Chart.js

The general principle: **the API should return chart-ready data, not raw transactions for the frontend to reduce.** Push aggregation into MongoDB's pipeline, not into the browser.

- **Net Worth (aggregated):** endpoint reads from the pre-computed `DailyBalanceSnapshot` collection, returns `[{ date, netWorth, assets, liabilities }]`. This should never touch the raw `Transactions` collection at request time. For an account with limited backfill history (see 30-day backfill in section 6), the series should start at that account's first snapshot date rather than implying a $0 balance before it existed — the frontend renders a visible gap/dashed segment for the period before an account was linked, not a flat line.
- **Monthly Cash Flow (income vs. expense):** an aggregation pipeline grouping `Transactions` by `$dateTrunc` month and `amount > 0 / < 0` (or a dedicated `direction` field), filtering out `excludeFromCashFlow: true` (transfers matched by the section 2.4 pass), returning `[{ month, income, expenses }]`. If this endpoint is hit often, back it with the same rollup-on-write pattern as net worth.
- **Categorical Spending Distribution:** `$group` by `category.value` within a date range, `$sum` amount, returned pre-sorted for the donut/bar chart. This one is cheap enough to compute on-demand given the compound category index above.
- **Recurring Subscription Tracking:** this is the one non-trivial query — it requires detecting *recurrence*, not just aggregating. A reasonable Phase 1 heuristic: group by `merchantNameNormalized`, and flag as recurring any merchant with ≥3 transactions where the amount is within a small tolerance band and the interval between dates clusters around ~30 or ~365 days (simple standard-deviation-on-interval check). This can run as a nightly batch job writing to a `Subscriptions` collection rather than a live query — subscription cadence doesn't need to be real-time. Plaid also now offers a native Recurring Transactions endpoint; worth evaluating as a swap-in for the DIY heuristic once Phase 1 is stable, rather than building both.
- **Comparison views (MoM/YoY, custom ranges):** dashboard endpoints accept a `range` and an optional `compareRange`, and compute both in a single `$facet` aggregation rather than two round trips, returning `{ current: [...], compare: [...] }`.

### 4.3 Live Dashboard Updates

The backing data changes asynchronously — a sync or categorization job can finish seconds or minutes after the user loaded the page. Use **Server-Sent Events**, not WebSockets: the traffic is one-directional (server → client, "something changed, go refetch"), so SSE avoids the reconnect/bidirectional complexity a WebSocket would add for no benefit here. A BullMQ `QueueEvents` listener inside `apps/api` publishes lightweight events (e.g., `{ type: 'sync.completed', connectionId }`, `{ type: 'transfer.matched' }`) to a `/events` SSE route (Fastify supports streaming responses natively); the frontend's SSE client calls `queryClient.invalidateQueries()` for the relevant feature on receipt. Keep React Query's background refetch interval on as a fallback in case the SSE connection drops — cheap insurance, and it's already built in.

### 4.4 Rollup Recompute Strategy

`DailyBalanceSnapshot`/`MonthlyRollup` are write-time aggregates, which means they can go stale: a Plaid `removed` event, a late-arriving `modified` transaction, or the transfer-matching pass in section 2.4 reclassifying a transaction as `excludeFromCashFlow` can all invalidate a rollup that was already computed. Rather than incremental delta math (fragile, especially for removals) or a full recompute on every change (wasteful), each job that mutates transactions — the sync job and the transfer-matching job alike — tracks which date buckets it touched during that run and enqueues a **targeted recompute** for just those buckets, using `$merge` to overwrite the affected `DailyBalanceSnapshot`/`MonthlyRollup` documents. This bounds recompute cost to what actually changed and gives both triggers (provider sync, transfer matching) a single shared recompute path.

---

## 5. Privacy & Self-Hosting

Since this holds real bank data, treat the following as non-negotiable from the start rather than "harden later":

- **Docker Compose topology**: separate containers for the web app (static Vite build, served as static files — no Node runtime needed for it), the API (Fastify), the BullMQ worker(s), MongoDB, Redis, and a reverse proxy (Caddy/Traefik) handling TLS termination and routing to the web/API containers. Workers and API should be separately scalable/restartable — you don't want a stuck LLM categorization job to require restarting the API.
- **Secrets management**: Plaid `client_id`/`secret`, OpenAI API key, and Mongo credentials should come from an `.env` file excluded from git, or better, Docker secrets / a mounted secrets file, never baked into the image.
- **Field-level encryption for sensitive fields**: consider encrypting account/routing numbers and raw payloads at rest (MongoDB Client-Side Field Level Encryption, or application-level AES-GCM before write) even though this is self-hosted — a stolen disk image shouldn't leak bank credentials in plaintext.
- **Network posture**: bind Mongo and Redis to the Docker internal network only, never exposed to the host's public interface. Only the reverse proxy should have an external port.
- **Backups**: since this is the system of record for financial history, a scheduled `mongodump` to encrypted, off-box storage is not optional — losing the raw Plaid history means losing the ability to ever reconcile discrepancies.
- **Plaid webhook verification**: verify webhook JWT signatures (Plaid signs webhooks) rather than trusting the payload, since the webhook endpoint will be internet-reachable.

---

## 6. Bottlenecks & Edge Cases to Document Now

- **Duplicate transactions from pending→posted transitions.** Plaid sends a `pending` transaction, then later sends a new `posted` transaction with `pending_transaction_id` referencing the original. Handling this incorrectly is the single most common source of double-counted spending in Plaid integrations — the sync handler must treat the pending record as superseded (soft-delete or link, never leave both as active) rather than inserting both as live transactions.
- **Plaid rate limits and Item error states.** Items can enter `ITEM_LOGIN_REQUIRED` (user needs to re-auth via Plaid Link update mode) — the sync worker needs to detect this error code, mark the account as needing re-auth, and stop retrying that Item until the user acts, rather than burning retry budget indefinitely.
- **Cursor drift / `PLAID_ERROR` on stale cursors.** If a cursor becomes invalid (e.g., after a long outage or Item re-link), Plaid returns an error requiring a full resync from an empty cursor — the worker needs an explicit "reset and full resync" path, not just retry-with-backoff.
- **LLM non-determinism and cost creep.** Without the Tier 1 write-back loop, LLM usage doesn't shrink over time, and categorization can be non-deterministic across runs for the same merchant. Structured JSON output plus low temperature helps, but the real fix is aggressive caching of LLM decisions into Tier 1.
- **Multi-currency accounts — descoped for MVP.** Single currency only for this iteration; no FX conversion logic, and no per-account currency validation at link time. `baseCurrency` is a fixed env var, `isoCurrencyCode` stays on the `Transaction`/`Account` schema for forward compatibility, but it's treated as a constant, not something the aggregation pipeline needs to reason about yet. Revisit (including whether to validate/exclude mismatched accounts) if a foreign-currency account is ever actually linked.
- **Timezone boundaries on "monthly" aggregation — mostly resolved by consistent UTC, with one wrinkle.** Storing and aggregating everything in UTC does eliminate the original concern (different parts of the pipeline disagreeing on what "month" a transaction falls in). The remaining gotcha isn't aggregation, it's display: Plaid's `date` field is a calendar date with no time-of-day component — it represents "the day the bank says this posted," not a moment in time. If that date string gets parsed into a JS `Date` and then rendered through the browser's local timezone, a UTC-midnight timestamp can flip back to the previous day for anyone west of UTC. So: aggregate in UTC (solved), but treat the field as a literal date string on display, not something to round-trip through timezone conversion.
- **Backfill volume on initial Item link — capped at 1 month for MVP.** Rather than pulling Plaid's full available history (up to 24 months), request only ~30 days of history via the `days_requested` config at Link initialization. Keeps the first sync fast and keeps day-one LLM categorization cost low. Full historical backfill can be added later as an explicit, user-triggered action rather than automatic default behavior.
- **Soft-delete propagation — resolved via targeted rollup recompute (section 4.4).** Plaid's `removed` array in the sync response means a transaction should disappear from the app — the sync job now includes the affected date bucket(s) in its recompute signal, so any rollup collection (net worth snapshots, monthly cash flow) that already included the removed transaction gets recomputed for just that bucket, not just the source record deleted.
- **Cross-account transfers aren't linked by Plaid — resolved via the transfer-matching pass (section 2.4).** Without it, a transfer between your own accounts (e.g., checking → savings, or a credit-card payment) shows up as both an expense and income, inflating cash-flow charts — this was the manual reconciliation step previously done by hand (e.g., in Spendee). The matching pass links both sides via `transferGroupId`, marks them `excludeFromCashFlow`, and ages unmatched `TRANSFER_*`-categorized transactions into Tier 4 review after a few days rather than leaving them silently unresolved.

---

## 7. Tech Stack & Repository Structure

### 7.1 Monorepo: pnpm workspaces + Turborepo

One repo, not one package. pnpm workspaces handle dependency linking between apps and packages; Turborepo handles cached, parallelized task running (`turbo run lint test build`) across them. Chosen over Nx for a solo project specifically because Nx's generator/plugin model is more machinery than one person needs — pnpm+Turborepo gets the caching and workspace-linking benefits with a fraction of the config surface.

```
/apps
  /web        — Vite + React SPA: dashboard UI only, no server-side rendering, talks to apps/api over HTTP + SSE
  /api        — Fastify: all HTTP-facing routes (dashboard endpoints, Plaid webhook receiver, SSE stream)
  /worker     — plain Node/TS process: BullMQ queues (provider-sync, categorize-llm, transfer-matching, rollups)
/packages
  /db         — Mongoose schemas + the repository layer (section 3.3): ConnectionRepository, AccountRepository, TransactionRepository, RollupRepository
  /providers  — FinancialProvider interface (section 2.1) + PlaidProvider adapter
  /shared     — shared TS types/constants used by all three apps (Transaction, Account, Connection shapes, category enums)
  /config     — shared tsconfig.base.json, eslint config, prettier config
```

### 7.2 Vite SPA for the frontend, Fastify for the API, plain Node for the worker

Three apps, three distinct jobs, all plain TypeScript with no shared "do everything" framework. `apps/web` is a Vite-built React SPA — client-rendered only, since there's no SEO or anonymous-traffic benefit to gain from SSR on a private, single-user, authenticated dashboard. `apps/api` is a Fastify server owning every HTTP-facing route: the per-widget dashboard endpoints from section 4.2, the Plaid webhook receiver, and the SSE stream from section 4.3. `apps/worker` stays exactly as before — a framework-free Node/TS process running the BullMQ queues, independent of any request lifecycle (queue workers need to run continuously regardless of framework, which is why section 5 already calls for the API and the worker(s) to be separately restartable/scalable Docker containers). All three import the same `db` and `providers` packages, so schema, repository, and provider-adapter logic is written once and shared, not duplicated.

Fastify was chosen over Hono for the API layer specifically because this is a long-running self-hosted Node process, not an edge/serverless deployment — Fastify has the more mature plugin ecosystem and first-class TypeScript + JSON-schema/Zod validation support for that deployment model, where Hono's strengths (small footprint, edge-runtime portability) matter less.

**Alternative considered and rejected: unified Next.js.** The original plan for this section was a single Next.js app handling both the dashboard UI and all API routes in one deploy unit. Reconsidered because Next.js's core strengths — SSR/RSC, SEO, caching for public/anonymous traffic — don't apply to a private single-user tool, so adopting it would mean carrying real framework complexity (the RSC server/client-component boundary, Next's fetch-caching semantics) for features never used. Decision: split into `apps/web` + `apps/api` as above. Tradeoff accepted: two apps/deploy units instead of one, in exchange for a simpler, more uniform "plain TypeScript everywhere" architecture that matches `apps/worker`'s existing style.

### 7.3 TypeScript

`strict: true` plus `noUncheckedIndexedAccess`, defined once in `packages/config/tsconfig.base.json` and extended by every app/package — one place to tighten rules later, and no workspace silently opting out of strictness.

### 7.4 Linting & formatting: ESLint + Prettier, enforced from day one

`typescript-eslint` as the base, plus `eslint-plugin-react` + `eslint-plugin-react-hooks` for `apps/web` (React-specific correctness rules — hooks-of-hooks, dependency arrays), and a plain Node/TS ruleset for `apps/api` and `apps/worker`. Prettier handles formatting, wired to a shared config in `packages/config`. Husky + lint-staged run lint and format on every commit; a GitHub Actions workflow runs lint + typecheck + test on every push, even solo — cheap insurance against the class of mistakes that otherwise surface at 11pm.

### 7.5 TDD: Vitest, with the seam drawn at "pure logic vs. queue glue"

Vitest as the test runner across every package (fast, native ESM/TS, works identically across `apps/web`, `apps/api`, and `apps/worker` since none of them are locked into a heavier framework's test setup) over Jest. The parts of this system worth testing hard aren't "does BullMQ retry correctly" — that's the library's job — they're the pure business logic: Tier 1/2 categorization resolution, the transfer-matching candidate logic (section 2.4), the subscription-recurrence heuristic (section 4.2), the rollup bucket-tracking logic (section 4.4). The practical consequence for how code gets structured: job handlers stay thin (queue glue only) and hand off to plain, framework-free functions that do the actual work — that's what makes TDD practical here, since a handler wrapping a well-tested pure function needs little testing of its own. Two testing layers:

- **Unit tests (Vitest)** — the pure logic above, plus React component tests (Testing Library) for the handful of components with real conditional logic (e.g., the net-worth chart's gap-rendering for partial history).
- **Integration tests (Vitest + `mongodb-memory-server`)** — the repository layer and the aggregation pipelines specifically (`$dateTrunc`, `$merge`, `$facet`). These have real Mongo semantics a mock won't catch, so they get actual database-backed tests rather than unit tests with a stubbed driver.

---

## 8. Proposed Project Documentation Outline

1. **System Overview** — problem statement, scope boundaries (ingestion + analytics only, no budgeting), high-level architecture diagram (API, workers, Mongo, Redis, frontend), monorepo structure & tech stack rationale (section 7).
2. **Data Ingestion Spec**
   - Provider abstraction (`FinancialProvider` interface, `Connection` lifecycle: linking, re-auth, unlinking)
   - `/transactions/sync` cursor handling and pagination contract
   - BullMQ queue topology, job types, retry/backoff policy, rate limiting
   - Webhook handling + signature verification
3. **Categorization Pipeline Spec**
   - Tier 1/2 rule schema and precedence rules
   - Tier 3 prompt design, structured output schema, batching strategy, cost budget
   - Tier 4 review UX and write-back mechanics into Tiers 1/2
   - Transfer-matching pass: candidate criteria, tolerance windows, `transferGroupId` linkage, review-queue aging
4. **Data Model Reference**
   - Full Mongoose schemas (Connection, Account, Transaction, RawPayload, MerchantRule, Subscription, DailyBalanceSnapshot)
   - Repository layer per aggregate (method inventory, no direct driver calls outside repositories)
   - Index rationale per collection
   - Amount/currency/date conventions
5. **Analytics & Rollup Jobs**
   - Rollup job schedule (what recomputes on sync completion, transfer-matching, vs. nightly)
   - Targeted recompute mechanism (affected-date-bucket tracking)
   - Per-dashboard-widget API contract (request params → response shape), including comparison-range (`$facet`) contract
   - Subscription-detection heuristic spec
6. **Frontend Architecture**
   - Feature-folder structure, data-fetching conventions (React Query patterns)
   - SSE event contract and query-invalidation mapping
   - Component inventory mapped to Shadcn primitives
7. **Security & Self-Hosting**
   - Docker Compose topology + network diagram
   - Secrets/encryption approach
   - Backup/restore procedure
   - Plaid webhook verification details
8. **Edge Case & Failure Mode Register**
   - Living document of the bottlenecks above, plus resolution status for each as they're addressed
9. **Open Questions / Deferred Decisions**
   - Explicitly log budgeting/burn-rate as out-of-scope-for-now, plus anything else punted during this discussion

---

*Prepared as a planning document — no implementation performed. Ready for review before Phase 2 (implementation) begins.*

---

## Decision Log (ADR-numbered — this section *is* the ADR record, not a pointer to separate files)

**Documentation strategy: two docs, not three (revised).** Originally planned `README.md` + `ARCHITECTURE.md` + one-file-per-decision under `docs/decisions/` + `BACKLOG.md`. Reconsidered: this section has, in practice, already been doing an ADR's job — what was decided, what alternatives were considered, and why — as prose entries in one place, not one file per decision. For a solo project there's no real audience for individually linkable files (no team reviewing a PR against one ADR, no cross-repo references), so splitting this into a dozen-plus separate numbered files is overhead without a matching benefit. Decision: drop `docs/decisions/` as its own folder. Final structure is just:
- `README.md` — quick orientation only.
- `ARCHITECTURE.md` — the proposal above, with this Decision Log as its closing section. Same "what/alternatives/why" discipline as a real ADR, same `ADR-000N` numbering for individual referenceability (e.g., from a code comment), just consolidated into one file instead of many. Section 6 (edge cases) stays a living register with resolution status per item, updated as issues are actually handled.
- `BACKLOG.md` (or external tracker) — kept separate since it churns much more often than architecture decisions.
- Overall philosophy unchanged: lightweight, versioned in the repo alongside code, not an external wiki that goes stale. One well-organized file achieves "future you understands why a decision was made" as well as a dozen small ones would, at a fraction of the upkeep.

- **ADR-0001 — Single-currency MVP.** No FX conversion, no per-account currency validation at link time. Full rationale in section 6.
- **ADR-0002 — 30-day backfill cap on initial account link.** Full rationale in section 6.
- **ADR-0003 — Serverful, not serverless.** Evaluated moving ingestion/categorization to a serverless stack (Lambda/SQS, Vercel + Upstash, etc.). Decision: stay serverful (BullMQ + Redis + Docker Compose as already specified). Rationale: this is a single-user personal tool, not a product being sold — the operational simplicity of a self-hosted, always-running stack outweighs any cost/scaling benefit serverless would offer, and serverless would also require handing more of the "self-hosted/private" story to third-party managed services (Atlas, Upstash, cloud functions), which cuts against the original privacy goal.
- **ADR-0004 — Provider abstraction adopted from day one.** All Plaid access goes through a `FinancialProvider` interface (section 2.1); the app layer works in terms of a provider-neutral `Connection`, not a Plaid Item. Rationale: renaming/abstracting later means touching schema fields and every query that references them — doing it before any code exists is nearly free.
- **ADR-0005 — DB abstraction scoped to a repository layer, not a backend-agnostic query layer.** Mongo's aggregation pipeline and denormalized schema are core to the design (section 3.1–3.2) and won't be hidden behind an abstraction; a repository-per-aggregate layer (section 3.3) is adopted so persistence calls are isolated and domain-named, bounding the blast radius of a hypothetical future relational migration without pretending to make it painless.
- **ADR-0006 — Transfer matching built in Phase 1, not deferred.** A post-categorization matching pass (section 2.4) links both sides of a cross-account transfer and excludes them from cash-flow aggregation. Rationale: this directly affects the correctness of the Phase 1 analytics (section 4) — an unmatched transfer silently inflates income/expense charts — so it belongs in the same phase as the categorization pipeline rather than punted alongside budgeting math.
- **ADR-0007 — Live dashboard updates via SSE, not WebSockets.** The data flow is one-directional (server → client "something finished, refetch"), so Server-Sent Events were chosen over WebSockets for lower complexity, backed by a BullMQ `QueueEvents` listener (section 4.3).
- **ADR-0008 — Rollup staleness resolved via targeted, bucket-scoped recompute.** Rather than incremental delta updates or full recomputes, any job that mutates transactions (sync, transfer-matching) tracks which date buckets it touched and triggers a `$merge`-based recompute scoped to just those buckets (section 4.4). This also resolves the previously-open "soft-delete propagation" edge case (section 6).
- **ADR-0009 — Currency validation at link time was proposed, then explicitly rejected.** Considered checking each linked account's `isoCurrencyCode` against a base currency and soft-excluding mismatches from aggregates. Decision: not now — stay with the original single-currency/env-var approach (ADR-0001, section 6). Revisit only if a foreign-currency account is actually linked.
- **ADR-0010 — Monorepo: pnpm workspaces + Turborepo.** Chosen over Nx for lower config overhead on a solo project — same caching/workspace-linking benefit, far less generator/plugin machinery (section 7.1).
- **ADR-0011 — Vite SPA (`apps/web`) + Fastify API (`apps/api`), not unified Next.js.** Two rounds of discussion: first, Next.js vs. a Next.js-as-backend-only variant (rejected — Next.js isn't meant to run headless as just an API layer); then unified Next.js vs. a genuine split, initially kept as unified Next.js, then reconsidered once framed plainly as "Next.js vs. Vite + Node.js" — landed on the split. Rationale: Next.js's core strengths (SSR/RSC, SEO, caching for anonymous traffic) don't apply to a private single-user dashboard, so keeping it would mean carrying real framework complexity for unused features (section 7.2).
- **ADR-0012 — ESLint + Prettier, not Biome.** `typescript-eslint` plus React-specific plugins for `apps/web`; a plain Node/TS ruleset for `apps/api`/`apps/worker`. Chosen for ecosystem maturity over Biome's simpler single-tool setup (section 7.4).
- **ADR-0013 — Vitest for TDD, not Jest.** Fast, native ESM/TS, consistent across all three apps. Job handlers stay thin so the actual business logic is pure and unit-testable; `mongodb-memory-server` covers aggregation-pipeline integration tests (section 7.5).
- **ADR-0014 — Fastify over Hono for `apps/api`.** This is a long-running self-hosted Node process, not an edge/serverless deployment — Fastify's plugin ecosystem and JSON-schema/Zod validation tooling fit that model better than Hono's edge-portability strengths (section 7.2).

---

## Open / Next Steps (pick up here in the new session)

1. **Story/backlog breakdown was requested but not yet produced.** Next action: break the architecture proposal into implementation stories, organized by epic (Provider Abstraction, Ingestion, Categorization Pipeline, Transfer Matching, Data Model, Analytics/Dashboard, Security & Deployment). Still need to decide: markdown backlog doc (grouped by epic, readable) vs. CSV/spreadsheet (importable into GitHub Projects/Linear/Trello). Ask the user which format they want before producing it.
2. Section 8's documentation outline (System Overview, Data Ingestion Spec, Categorization Pipeline Spec, etc.) is still just an outline — none of those sub-documents have been written yet. These would typically get filled in alongside or just ahead of the corresponding implementation stories.
3. No code has been written. Phase 2 (implementation) has not started.
4. **Resolved in this session** (previously open, now reflected throughout the proposal above): provider abstraction (section 2.1), DB abstraction scope (section 3.3), transfer matching brought into Phase 1 (section 2.4), live-update mechanism (section 4.3), rollup recompute strategy (section 4.4), the full tech stack — monorepo, Vite SPA + Fastify API + separate worker (three apps, not two), TypeScript, linting, TDD (section 7) — and the documentation strategy itself (dropped `docs/decisions/` as separate files; ADR-0001–0014 now live as a single Decision Log section, not yet copied into an actual `ARCHITECTURE.md` file). Currency validation at link time was proposed and then explicitly rejected — staying with the original single-currency/env-var approach (section 6).
5. **Tech stack is now decided (section 7), including the frontend/backend split.** Went through two rounds on this specifically: Next.js-as-backend-only was rejected first, then unified Next.js itself was reconsidered and rejected in favor of `apps/web` (Vite SPA) + `apps/api` (Fastify) as separate apps — see section 7.2 and the Decision Log for the full reasoning. Per the user's request, the next step once this is reviewed is producing the actual documentation set — now just `ARCHITECTURE.md` (proposal + embedded Decision Log) and `BACKLOG.md` — as real files, not just this outline.
