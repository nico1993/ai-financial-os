# Personal Financial OS — Architecture

**Status:** Phase 1 (architecture finalized). Phase 2 (implementation) not yet started.

## 0. Scope

Personal Financial OS is a self-hosted, automated personal finance engine: it ingests bank data via Plaid and provides analytics/dashboards. It is a solo project — one user, not a product being built for multiple tenants — so architectural choices favor simplicity and low operational overhead over scalability.

**In scope for this phase:** data ingestion (Plaid sync, categorization, transfer reconciliation) and analytics/dashboards.

**Explicitly out of scope for this phase:** budgeting math (burn-rate, allowance logic).

---

## 1. Executive Summary

The core architectural bet is to treat this system as an **event-sourced ledger with a derived read model**, not a simple CRUD app over a `transactions` table. Plaid's `/transactions/sync` endpoint is itself a change-stream (added/modified/removed), so the ingestion layer is built around that abstraction from day one rather than bolted on later.

Five decisions anchor the ingestion/data side; the tech stack (section 7) anchors everything else:

1. **BullMQ + Redis as the sync orchestrator**, with one queue for provider webhooks/polling and a separate queue for categorization, so a slow LLM call never blocks transaction ingestion.
2. **A 4-tier categorization pipeline implemented as a single BullMQ flow (parent/child jobs)**, where each tier is a discrete job type that can be retried, monitored, and cost-audited independently.
3. **Raw payloads stored immutably, cleaned/normalized documents stored separately**, linked by a stable `providerTransactionId`. This gives replay-ability if categorization logic or schema changes later.
4. **MongoDB schemas denormalized for time-series read performance**, with compound indexes built around the actual dashboard queries (net worth over time, monthly cash flow, category breakdown) rather than a generic index-everything approach.
5. **Docker Compose as the deployment unit from the start**, with secrets, encryption keys, and Plaid credentials treated as first-class infrastructure concerns, not app config.

---

## 2. Data Ingestion Architecture

### 2.1 Provider Abstraction Layer

Plaid is the only provider for Phase 1, but the ingestion and categorization pipeline never call the Plaid SDK directly — they call a `FinancialProvider` interface, with `providers/plaid/PlaidProvider.ts` as the sole implementation for now:

```
interface FinancialProvider {
  createLinkToken(input): Promise<{ linkToken }>
  createConnection(publicToken): Promise<ConnectionResult>
  syncTransactions(connection, cursor): Promise<{ added, modified, removed, nextCursor, hasMore }>
  getAccounts(connection): Promise<NormalizedAccount[]>
  verifyWebhook(req): Promise<boolean>
  parseWebhook(body): ProviderWebhookEvent
}
```

`createLinkToken` isn't in the original sketch above — Plaid Link can't initialize client-side without a server-issued `link_token`, and the same "never call the Plaid SDK directly outside the adapter" rule that motivates this interface means that call has to live here too. It bakes in the 30-day backfill cap (ADR-0002, via `days_requested`) so callers don't have to know that constant exists. `verifyWebhook` is `Promise<boolean>`, not the synchronous `boolean` this section originally sketched — real JWK-based signature verification requires an async key fetch. See ADR-0017. `parseWebhook` is a later addition for the same reason (ADR-0024): the webhook receiver has to know whether a payload means "sync this connection", and reading Plaid's `webhook_code` in a route would put provider-specific naming right where this abstraction exists to keep it out.

The "Plaid Item" concept is renamed to the provider-neutral **`Connection`** everywhere in the app layer (jobs, routes, UI) — Plaid-specific naming (`itemId`, `plaid_error`) stays inside the adapter only. Intentionally lightweight for a solo project: no dynamic plugin loading, no attempt to support multiple providers simultaneously — just enough indirection that a second provider (a different aggregator, or a manual CSV-import "provider") means writing a new adapter, not touching the sync or categorization pipeline. See ADR-0004.

### 2.2 Plaid `/transactions/sync` + BullMQ/Redis

Plaid's sync endpoint is cursor-based: send a `cursor` (empty on first call), get back `added`, `modified`, `removed` arrays plus `has_more` and a `next_cursor`. The worker's job is to drain that cursor to completion on every trigger, not just fetch once.

Queue structure:

- **`provider-sync` queue** — one job per `connectionId` (a `Connection` roughly maps to one linked bank login; today that's always a Plaid Item under the hood). Triggered by (a) provider webhooks (Plaid's `SYNC_UPDATES_AVAILABLE`), and (b) a scheduled BullMQ repeatable job as a fallback safety net (e.g., every 4–6 hours) in case a webhook is missed.
- **Job body** contains only `{ connectionId }` — the job handler loads the current cursor from the `Connections` collection at execution time, not at enqueue time, and resolves the right `FinancialProvider` adapter from the connection's `provider` field. This avoids stale-cursor bugs if multiple sync jobs for the same connection get queued back to back.
- **Idempotency lock**: use a Redis lock (or BullMQ's built-in job-id deduplication, e.g. `jobId: `sync:${connectionId}`` with `removeOnComplete`) so a webhook retry and a scheduled poll for the same connection can't run concurrently and race on the cursor. **Correction:** that `jobId` example is not usable as written — BullMQ rejects any custom job id containing `:`, since colons are its own Redis key separator. The implementation uses `sync-{connectionId}`; see ADR-0022.
- **Pagination loop inside the job**: while `has_more` is true, keep calling sync with the returned `next_cursor`, persisting the cursor to the DB after each page (not just at the end) so a crash mid-pagination resumes cleanly rather than reprocessing from scratch.
- **Rate limits**: Plaid enforces per-Item and per-client rate limits. Use BullMQ's `limiter` option on the queue (e.g., max N jobs per second) rather than ad hoc `setTimeout` throttling, and treat `429`s as retryable with exponential backoff (BullMQ's built-in `attempts` + `backoff` job options).
- **On completion**, the sync job enqueues categorization jobs (one per new/modified transaction, or batched) into a separate queue — keeping ingestion throughput decoupled from categorization latency.

### 2.3 The 4-Tier Categorization Pipeline

Model this as a **BullMQ Flow**: a parent "categorize transaction" job with a chain of child job types, where each tier either resolves the category (short-circuiting later tiers) or falls through.

- **Tier 1 — Exact Match (static).** A synchronous lookup against a `MerchantRules` collection keyed on Plaid's cleaned merchant name / `personal_finance_category` or a normalized merchant string. Runs **inline in the sync job itself**, not as a separate queued job — it's a cheap DB read and doesn't need queue overhead. Maybe 60–80% of recurring transactions (subscriptions, known payroll, known utilities) resolve here instantly.
- **Tier 2 — Regex/Fuzzy (user-defined).** User-authored rules (e.g., "if description matches `/UBER \*TRIP/i` → Transportation"). Also inline/synchronous — regex evaluation against a small rule list is fast. Store rules with a `priority` field so overlapping rules order deterministically. This is also where fuzzy matching (Levenshtein/trigram) applies against previously-categorized merchants manually corrected before, effectively "learning" from Tier 4 corrections.
- **Tier 3 — LLM Inference (async, queued).** Only transactions that fall through Tiers 1–2 get queued into a `categorize-llm` queue. Batch these (e.g., 20–50 transactions per OpenAI call) using structured JSON output (function calling / JSON schema mode) to minimize per-call overhead and cost. This queue has its own concurrency limit and rate limiter independent of the provider-sync queue, since OpenAI has its own rate limits and cost profile. Cache LLM decisions back into the Tier 1 exact-match table keyed on the normalized merchant string — this is the mechanism by which Tier 3 usage should shrink over time as the exact-match table absorbs prior LLM decisions.
- **Tier 4 — Human-in-the-loop.** Anything the LLM returns with low confidence (require a `confidence` field in the structured output) or explicitly flags as `uncertain`, plus anything manually recategorized, lands in a `needs_review` status on the transaction. This is a dashboard queue, not a background job — it's UI-driven. A manual correction here writes back into the Tier 1/Tier 2 rule tables, closing the loop so the same merchant never needs LLM inference again.

The efficiency argument for separating these into distinct tiers isn't just cost (LLM calls are the expensive path) — it's also that Tiers 1–2 are deterministic and auditable, which matters for a financial system where "why was this categorized as X" needs a concrete answer.

### 2.4 Transfer Matching (Cross-Account Reconciliation)

Plaid does not link the two sides of a transfer between your own accounts — there's no `transaction_id` relationship connecting, say, a "Transfer to Savings" debit in checking with the corresponding credit in savings, or a credit-card payment leaving checking with the payment landing on the card. All Plaid gives you is a signal, via `personal_finance_category` (`TRANSFER_IN` / `TRANSFER_OUT`, or detailed values like `TRANSFER_OUT_ACCOUNT_TRANSFER`, `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`) — it flags "this is probably a transfer," not who its counterpart is.

A **transfer-matching pass** runs as a queued job after categorization completes for a sync batch:

- Scope the search to the user's own accounts (never cross-user).
- Candidate pairs: opposite-signed transactions with equal (or near-equal, to allow for a fee) magnitude, where at least one side has a `TRANSFER_*` or payment-type category, and dates fall within a small tolerance window (a few days — ACH transfers commonly settle 1–3 days apart across accounts).
- On a match, link both sides via a shared `transferGroupId` and set `excludeFromCashFlow: true` on both — this is the critical part, since an unflagged internal transfer otherwise counts as both income and an expense and inflates every cash-flow chart in section 4.
- Unmatched `TRANSFER_*`-categorized transactions age into the Tier 4 review queue after a short window (e.g., 3 days with no match found), rather than sitting silently unresolved — confirm it's an external transfer (leave as-is) or manually pair it.
- This pass emits the same "affected date range" signal used by the sync job (see section 4.4) so any rollup that already included the now-reclassified transactions gets recomputed.

See ADR-0006.

---

## 3. Data Modeling & Performance

### 3.1 Raw vs. Cleaned Data

Store two collections per data type: `RawPlaidTransactions` (or a generic `RawPayloads` collection with a `source`/`type` discriminator) holding the untouched Plaid response, and `Transactions` holding the normalized, app-facing document. Link them via `providerTransactionId` (Plaid's `transaction_id`), not by MongoDB `_id`.

Reasons this matters more here than in a typical CRUD app:

- **Auditability** — if a categorization is disputed or a balance looks wrong, show exactly what the bank sent.
- **Replay-ability** — if categorization logic, normalization rules, or schema change later, reprocess `RawPlaidTransactions` into a new `Transactions` collection without re-hitting Plaid's API (which has both rate limits and a cost per Item).
- **Plaid data corrections** — Plaid itself sometimes retroactively modifies a `pending` transaction into a `posted` one with a different `transaction_id` (pending→posted linkage via `pending_transaction_id`). Keeping the raw record lets you reconcile this cleanly rather than ending up with duplicate cleaned transactions.

Raw payloads are a simple insert-only collection (no updates), which keeps write patterns cheap. Cleaned `Transactions` documents are the ones indexes and queries are built around.

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
  merchantNameNormalized  // normalized/lowercased key for Tier 1 lookups
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

Key modeling decisions: amounts as **integer cents**, not floats or Decimal128 unless sub-cent precision is specifically needed (it isn't, for a personal finance tool) — avoids floating point drift in aggregation pipelines. Dates as native `Date` objects in UTC, with timezone conversion happening at the presentation layer, so `$dateTrunc`/`$group` by month work correctly in aggregation without string parsing.

**Indexes** to support the dashboard's actual query patterns:

- `{ userId: 1, date: -1 }` — the workhorse index; almost every dashboard query filters by user and sorts/ranges by date.
- `{ userId: 1, 'category.value': 1, date: -1 }` — for categorical spending distribution and category drill-downs.
- `{ providerTransactionId: 1 }` unique — for upsert-on-sync idempotency (this is what makes Plaid's added/modified/removed events safe to apply as upserts).
- `{ accountId: 1, date: -1 }` — for per-account views and net worth reconciliation.
- `{ userId: 1, 'category.status': 1 }` — for the Tier 4 review queue.
- `{ transferGroupId: 1 }` sparse — for looking up both sides of a matched transfer.

For net worth and monthly cash flow, don't recompute from raw transactions on every dashboard load — use MongoDB's `$merge`/scheduled aggregation into a pre-computed `DailyBalanceSnapshot` or `MonthlyRollup` collection (populated by a nightly or post-sync job), and have the dashboard read from that. Write-time aggregation for anything read on every page load; on-demand aggregation only for ad hoc/drill-down queries.

### 3.3 Persistence Layer / Database Abstraction

Mongo was chosen specifically for its aggregation pipeline (`$dateTrunc`, `$merge`, compound indexes) and denormalized document shape — that choice doesn't disappear behind an abstraction, and a genuinely backend-agnostic query layer is over-engineering for a one-user system. What's worth doing: put every persistence operation behind a **repository per aggregate** (`ConnectionRepository`, `AccountRepository`, `TransactionRepository`, `RollupRepository`, `RawPayloadRepository` — plus `UserRepository` for ADR-0018's auth), with domain-shaped method names — `upsertFromSync()`, `findByUserAndDateRange()`, `getMonthlyRollup(userId, range)` — rather than exposing the native driver or generic CRUD to routes and job handlers. This keeps intent readable regardless of backing store, and means a future relational migration is contained to rewriting repository internals and rollup jobs rather than a rewrite scattered through the whole app — it won't make such a migration painless (aggregation-pipeline logic and document shape are still Mongo-specific), but it bounds the blast radius. See ADR-0005.

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

Each feature owns its own data hook (React Query / TanStack Query — caching, background refetch on sync completion, and loading/error states for free, which matters when the backing data updates asynchronously via BullMQ jobs the frontend didn't trigger). Use Shadcn's `Card`, `Tabs`, and `DataTable` primitives as the layout scaffolding rather than custom-building dashboard chrome. Since it's a private single-user dashboard behind auth, there's no need for SSR/SSG — a plain client-rendered SPA is simpler and there's nothing to gain from server rendering here.

### 4.2 Serving Data to Recharts/Chart.js

The general principle: **the API returns chart-ready data, not raw transactions for the frontend to reduce.** Push aggregation into MongoDB's pipeline, not into the browser.

- **Net Worth (aggregated):** endpoint reads from the pre-computed `DailyBalanceSnapshot` collection, returns `[{ date, netWorth, assets, liabilities }]`. Never touches the raw `Transactions` collection at request time. For an account with limited backfill history (see 30-day backfill in section 6), the series starts at that account's first snapshot date rather than implying a $0 balance before it existed — the frontend renders a visible gap/dashed segment for the period before an account was linked, not a flat line.
- **Monthly Cash Flow (income vs. expense):** an aggregation pipeline grouping `Transactions` by `$dateTrunc` month and `amount > 0 / < 0` (or a dedicated `direction` field), filtering out `excludeFromCashFlow: true` (transfers matched by the section 2.4 pass), returning `[{ month, income, expenses }]`. If hit often, back it with the same rollup-on-write pattern as net worth.
- **Categorical Spending Distribution:** `$group` by `category.value` within a date range, `$sum` amount, returned pre-sorted for the donut/bar chart. Cheap enough to compute on-demand given the compound category index above.
- **Recurring Subscription Tracking:** requires detecting *recurrence*, not just aggregating. Phase 1 heuristic: group by `merchantNameNormalized`, flag as recurring any merchant with ≥3 transactions where the amount is within a small tolerance band and the interval between dates clusters around ~30 or ~365 days (simple standard-deviation-on-interval check). Runs as a nightly batch job writing to a `Subscriptions` collection rather than a live query. Plaid also offers a native Recurring Transactions endpoint; worth evaluating as a swap-in for the DIY heuristic once Phase 1 is stable.
- **Comparison views (MoM/YoY, custom ranges):** dashboard endpoints accept a `range` and an optional `compareRange`, computed in a single `$facet` aggregation rather than two round trips, returning `{ current: [...], compare: [...] }`.

### 4.3 Live Dashboard Updates

The backing data changes asynchronously — a sync or categorization job can finish seconds or minutes after the page loaded. Use **Server-Sent Events**, not WebSockets: the traffic is one-directional (server → client, "something changed, go refetch"), so SSE avoids the reconnect/bidirectional complexity a WebSocket would add for no benefit here. A BullMQ `QueueEvents` listener inside `apps/api` publishes lightweight events (e.g., `{ type: 'sync.completed', connectionId }`, `{ type: 'transfer.matched' }`) to a `/events` SSE route (Fastify supports streaming responses natively); the frontend's SSE client calls `queryClient.invalidateQueries()` for the relevant feature on receipt. Keep React Query's background refetch interval on as a fallback in case the SSE connection drops. See ADR-0007.

### 4.4 Rollup Recompute Strategy

`DailyBalanceSnapshot`/`MonthlyRollup` are write-time aggregates, which means they can go stale: a Plaid `removed` event, a late-arriving `modified` transaction, or the transfer-matching pass reclassifying a transaction as `excludeFromCashFlow` can all invalidate a rollup already computed. Rather than incremental delta math (fragile, especially for removals) or a full recompute on every change (wasteful), each job that mutates transactions — the sync job and the transfer-matching job alike — tracks which date buckets it touched during that run and enqueues a **targeted recompute** for just those buckets, using `$merge` to overwrite the affected documents. This bounds recompute cost to what actually changed and gives both triggers (provider sync, transfer matching) a single shared recompute path. See ADR-0008.

---

## 5. Privacy & Self-Hosting

Since this holds real bank data, the following are non-negotiable from the start rather than "harden later":

- **Docker Compose topology**: separate containers for the web app (static Vite build, served as static files — no Node runtime needed for it), the API (Fastify), the BullMQ worker(s), MongoDB, Redis, and a reverse proxy (Caddy/Traefik) handling TLS termination and routing to the web/API containers. Workers and API are separately scalable/restartable — a stuck LLM categorization job should never require restarting the API.
- **Secrets management**: Plaid `client_id`/`secret`, OpenAI API key, and Mongo credentials come from an `.env` file excluded from git, or better, Docker secrets / a mounted secrets file, never baked into the image.
- **Field-level encryption for sensitive fields**: consider encrypting account/routing numbers and raw payloads at rest (MongoDB Client-Side Field Level Encryption, or application-level AES-GCM before write) even though this is self-hosted — a stolen disk image shouldn't leak bank credentials in plaintext.
- **Network posture**: bind Mongo and Redis to the Docker internal network only, never exposed to the host's public interface. Only the reverse proxy has an external port.
- **Backups**: since this is the system of record for financial history, a scheduled `mongodump` to encrypted, off-box storage is not optional — losing the raw Plaid history means losing the ability to ever reconcile discrepancies.
- **Plaid webhook verification**: verify webhook JWT signatures (Plaid signs webhooks) rather than trusting the payload, since the webhook endpoint is internet-reachable.
- **Authentication**: session-based login (`User` collection, bcrypt-hashed passwords, Redis-backed session cookie) gates every route except `/api/auth/*` and the Plaid webhook receiver (which verifies its own JWT instead). Chosen over a shared API token or reverse-proxy Basic Auth because more than one person may eventually have their own login — a shared secret has no way to identify or revoke one person's access without rotating it for everyone. See ADR-0018.

---

## 6. Bottlenecks & Edge Cases (Living Register)

This section stays a living register with resolution status per item, updated as issues are actually handled — not a write-once doc.

- **Duplicate transactions from pending→posted transitions — resolved in ING-9.** Plaid sends a `pending` transaction, then later a new `posted` transaction with `pending_transaction_id` referencing the original. Handling this incorrectly is the single most common source of double-counted spending in Plaid integrations — the sync handler must treat the pending record as superseded (soft-delete or link, never leave both as active) rather than inserting both as live transactions. The sync job soft-removes the pending record when its posted counterpart lands, records *both* date buckets for recompute (a transaction authorized Friday and settled Monday was already counted in the earlier bucket), and carries any real category across — otherwise a manual Tier 4 correction made while the transaction was pending is silently discarded the moment it settles. A posted transaction whose account can't be resolved does *not* supersede its pending counterpart, since that would delete the only surviving record of the spend.
- **Plaid rate limits and Item error states — resolved in ING-6 and ING-10.** Items can enter `ITEM_LOGIN_REQUIRED` (re-auth via Plaid Link update mode needed) — the sync worker detects this error code, marks the account as needing re-auth, and stops retrying that Item until the user acts, rather than burning retry budget indefinitely. Two distinct terminal states are tracked, because the recoveries differ: `login_required` (re-auth via Link update mode) and `error` (access revoked — the connection has to be created again). Both are raised as `UnrecoverableError`, which stops BullMQ's remaining attempts immediately rather than backing off against an Item that cannot succeed, and both drop the connection out of ING-8's poll, which only sweeps `active` connections. Rate limits are handled separately (ADR-0023): a 429 pauses the whole queue and does not consume an attempt.
- **Cursor drift / `PLAID_ERROR` on stale cursors — resolved in ING-11.** If a cursor becomes invalid (e.g., after a long outage or Item re-link), Plaid returns an error requiring a full resync from an empty cursor — the worker needs an explicit "reset and full resync" path, not just retry-with-backoff. Two failure modes are deliberately kept apart: an *invalid cursor* clears the stored cursor and resyncs from empty (once — a second invalid-cursor failure propagates rather than looping), while a *mutation during pagination* restarts the drain from the cursor the run began with and leaves the stored cursor untouched. Conflating them would throw away a perfectly good cursor and force a needless full resync every time the bank posted something mid-drain. Restarts are bounded, so a provider stuck in that state fails the job to BullMQ's backoff instead of spinning the worker, and each attempt's counters are local so an abandoned pass isn't summed into the result.
- **LLM non-determinism and cost creep.** Without the Tier 1 write-back loop, LLM usage doesn't shrink over time, and categorization can be non-deterministic across runs for the same merchant. Structured JSON output plus low temperature helps, but the real fix is aggressive caching of LLM decisions into Tier 1.
- **Multi-currency accounts — descoped for MVP (ADR-0001).** Single currency only for this iteration; no FX conversion logic, and no per-account currency validation at link time. `baseCurrency` is a fixed env var, `isoCurrencyCode` stays on the `Transaction`/`Account` schema for forward compatibility, but it's treated as a constant, not something the aggregation pipeline needs to reason about yet. Revisit (including whether to validate/exclude mismatched accounts) if a foreign-currency account is ever actually linked.
- **Timezone boundaries on "monthly" aggregation — mostly resolved by consistent UTC, with one wrinkle.** Storing and aggregating everything in UTC eliminates the original concern (different parts of the pipeline disagreeing on what "month" a transaction falls in). The remaining gotcha is display: Plaid's `date` field is a calendar date with no time-of-day component — it represents "the day the bank says this posted," not a moment in time. If that date string gets parsed into a JS `Date` and rendered through the browser's local timezone, a UTC-midnight timestamp can flip back to the previous day for anyone west of UTC. So: aggregate in UTC (solved), but treat the field as a literal date string on display, not something to round-trip through timezone conversion.
- **Backfill volume on initial Item link — capped at 1 month for MVP (ADR-0002).** Rather than pulling Plaid's full available history (up to 24 months), request only ~30 days via `days_requested` at Link initialization. Keeps the first sync fast and day-one LLM categorization cost low. Full historical backfill can be added later as an explicit, user-triggered action.
- **Soft-delete propagation — resolved via targeted rollup recompute (section 4.4, ADR-0008).** Plaid's `removed` array means a transaction should disappear from the app — the sync job includes the affected date bucket(s) in its recompute signal, so any rollup collection that already included the removed transaction gets recomputed for just that bucket, not just the source record deleted.
- **Cross-account transfers aren't linked by Plaid — resolved via the transfer-matching pass (section 2.4, ADR-0006).** Without it, a transfer between your own accounts (e.g., checking → savings, or a credit-card payment) shows up as both an expense and income, inflating cash-flow charts. The matching pass links both sides via `transferGroupId`, marks them `excludeFromCashFlow`, and ages unmatched `TRANSFER_*`-categorized transactions into Tier 4 review after a few days rather than leaving them silently unresolved.

---

## 7. Tech Stack & Repository Structure

### 7.1 Monorepo: pnpm workspaces + Turborepo

One repo, not one package. pnpm workspaces handle dependency linking between apps and packages; Turborepo handles cached, parallelized task running (`turbo run lint test build`) across them. Chosen over Nx specifically because Nx's generator/plugin model is more machinery than a solo project needs — pnpm+Turborepo gets the caching and workspace-linking benefits with a fraction of the config surface. See ADR-0010.

```
/apps
  /web        — Vite + React SPA: dashboard UI only, no server-side rendering, talks to apps/api over HTTP + SSE
  /api        — Fastify: all HTTP-facing routes (dashboard endpoints, Plaid webhook receiver, SSE stream)
  /worker     — plain Node/TS process: BullMQ queues (provider-sync, categorize-llm, transfer-matching, rollups)
/packages
  /db         — Mongoose schemas + the repository layer (section 3.3): Connection/Account/Transaction/Rollup/RawPayload/User repositories
  /providers  — FinancialProvider interface (section 2.1) + PlaidProvider adapter
  /shared     — shared TS types/constants used by all three apps (Transaction, Account, Connection shapes, category enums)
  /config     — shared tsconfig.base.json, eslint config, prettier config
```

### 7.2 Vite SPA for the frontend, Fastify for the API, plain Node for the worker

Three apps, three distinct jobs, all plain TypeScript with no shared "do everything" framework. `apps/web` is a Vite-built React SPA — client-rendered only, since there's no SEO or anonymous-traffic benefit to gain from SSR on a private, single-user, authenticated dashboard. `apps/api` is a Fastify server owning every HTTP-facing route: the per-widget dashboard endpoints from section 4.2, the Plaid webhook receiver, and the SSE stream from section 4.3. `apps/worker` is a framework-free Node/TS process running the BullMQ queues, independent of any request lifecycle (queue workers need to run continuously regardless of framework, which is why section 5 calls for the API and the worker(s) to be separately restartable/scalable Docker containers). All three import the same `db` and `providers` packages, so schema, repository, and provider-adapter logic is written once and shared.

Fastify was chosen over Hono for the API layer specifically because this is a long-running self-hosted Node process, not an edge/serverless deployment — Fastify has the more mature plugin ecosystem and first-class TypeScript + JSON-schema/Zod validation support for that deployment model. See ADR-0011, ADR-0014.

`apps/api` (and later `apps/worker`) import `packages/db` and `packages/providers` as workspace packages, run directly from TypeScript source via `tsx` — no per-package build/`dist` step. `pnpm dev` and the Docker `CMD` both run `tsx`; `packages/*/package.json`'s `"build"` script stays a placeholder until a real production build (bundling, `tsc`-emitted `dist`) is actually needed. See ADR-0019.

### 7.3 TypeScript

`strict: true` plus `noUncheckedIndexedAccess`, defined once in `packages/config/tsconfig.base.json` and extended by every app/package — one place to tighten rules later, and no workspace silently opting out of strictness.

### 7.4 Linting & formatting: ESLint + Prettier, enforced from day one

`typescript-eslint` as the base, plus `eslint-plugin-react` + `eslint-plugin-react-hooks` for `apps/web` (React-specific correctness rules — hooks-of-hooks, dependency arrays), and a plain Node/TS ruleset for `apps/api` and `apps/worker`. Prettier handles formatting, wired to a shared config in `packages/config`. Husky + lint-staged run lint and format on every commit; a GitHub Actions workflow runs lint + typecheck + test on every push, even solo — cheap insurance against the class of mistakes that otherwise surface at 11pm. See ADR-0012.

### 7.5 TDD: Vitest, with the seam drawn at "pure logic vs. queue glue"

Vitest as the test runner across every package (fast, native ESM/TS, works identically across `apps/web`, `apps/api`, and `apps/worker`) over Jest. The parts of this system worth testing hard aren't "does BullMQ retry correctly" — that's the library's job — they're the pure business logic: Tier 1/2 categorization resolution, the transfer-matching candidate logic, the subscription-recurrence heuristic, the rollup bucket-tracking logic. The practical consequence: job handlers stay thin (queue glue only) and hand off to plain, framework-free functions that do the actual work — that's what makes TDD practical here. Two testing layers:

- **Unit tests (Vitest)** — the pure logic above, plus React component tests (Testing Library) for the handful of components with real conditional logic (e.g., the net-worth chart's gap-rendering for partial history).
- **Integration tests (Vitest + `mongodb-memory-server`)** — the repository layer and the aggregation pipelines specifically (`$dateTrunc`, `$merge`, `$facet`). These have real Mongo semantics a mock won't catch, so they get actual database-backed tests rather than unit tests with a stubbed driver.

See ADR-0013.

---

## 8. Decision Log (ADR-numbered)

This section is the project's ADR record — no separate `docs/decisions/` files. Each entry captures what was decided, what alternatives were considered, and why, so "future you" doesn't have to reconstruct the reasoning later.

- **ADR-0001 — Single-currency MVP.** No FX conversion, no per-account currency validation at link time. `baseCurrency` is a fixed env var. Full detail in section 6.
- **ADR-0002 — 30-day backfill cap on initial account link.** Full detail in section 6.
- **ADR-0003 — Serverful, not serverless.** Evaluated moving ingestion/categorization to a serverless stack (Lambda/SQS, Vercel + Upstash, etc.). Decision: stay serverful (BullMQ + Redis + Docker Compose). Rationale: single-user personal tool, not a product being sold — the operational simplicity of a self-hosted, always-running stack outweighs any cost/scaling benefit serverless would offer, and serverless would hand more of the "self-hosted/private" story to third-party managed services (Atlas, Upstash, cloud functions), cutting against the privacy goal.
- **ADR-0004 — Provider abstraction adopted from day one.** All Plaid access goes through a `FinancialProvider` interface (section 2.1); the app layer works in terms of a provider-neutral `Connection`, not a Plaid Item. Rationale: renaming/abstracting later means touching schema fields and every query that references them — doing it before any code exists is nearly free.
- **ADR-0005 — DB abstraction scoped to a repository layer, not a backend-agnostic query layer.** Mongo's aggregation pipeline and denormalized schema are core to the design and won't be hidden behind an abstraction; a repository-per-aggregate layer (section 3.3) isolates persistence calls and bounds the blast radius of a hypothetical future relational migration without pretending to make it painless.
- **ADR-0006 — Transfer matching built in Phase 1, not deferred.** A post-categorization matching pass (section 2.4) links both sides of a cross-account transfer and excludes them from cash-flow aggregation. Rationale: directly affects the correctness of Phase 1 analytics — an unmatched transfer silently inflates income/expense charts.
- **ADR-0007 — Live dashboard updates via SSE, not WebSockets.** One-directional data flow (server → client "something finished, refetch"), so SSE for lower complexity, backed by a BullMQ `QueueEvents` listener.
- **ADR-0008 — Rollup staleness resolved via targeted, bucket-scoped recompute.** Rather than incremental delta updates or full recomputes, any job that mutates transactions tracks which date buckets it touched and triggers a `$merge`-based recompute scoped to just those buckets. Also resolves the "soft-delete propagation" edge case.
- **ADR-0009 — Currency validation at link time was proposed, then explicitly rejected.** Considered checking each linked account's `isoCurrencyCode` against a base currency and soft-excluding mismatches from aggregates. Decision: not now — stay with ADR-0001. Revisit only if a foreign-currency account is actually linked.
- **ADR-0010 — Monorepo: pnpm workspaces + Turborepo.** Chosen over Nx for lower config overhead on a solo project.
- **ADR-0011 — Vite SPA (`apps/web`) + Fastify API (`apps/api`), not unified Next.js.** Next.js's core strengths (SSR/RSC, SEO, caching for anonymous traffic) don't apply to a private single-user dashboard, so keeping it would mean carrying real framework complexity for unused features.
- **ADR-0012 — ESLint + Prettier, not Biome.** Chosen for ecosystem maturity, particularly React-specific correctness rules for `apps/web`.
- **ADR-0013 — Vitest for TDD, not Jest.** Fast, native ESM/TS, consistent across all three apps.
- **ADR-0014 — Fastify over Hono for `apps/api`.** Long-running self-hosted Node process, not an edge/serverless deployment — Fastify's plugin ecosystem and validation tooling fit that model better.
- **ADR-0015 — Caddy over Traefik for the reverse proxy.** Section 5 left this as an either/or; SETUP-9 needed a concrete choice. Decision: Caddy — automatic HTTPS via Let's Encrypt with effectively zero config, and a Caddyfile that's dramatically simpler than Traefik's label-based or file-provider routing config, with no extra moving pieces (no separate cert-manager/ACME container) to operate. Traefik's core strength — dynamic service discovery as containers come and go — matters more for a multi-service platform with frequent deploys than for a solo, fixed-topology self-hosted stack. See `proxy/Caddyfile`.
- **ADR-0016 — `Connection.accessToken` added to the §3.2 schema.** The original Connection sketch (section 3.2) didn't include a field for Plaid's `access_token`, but `FinancialProvider.syncTransactions()` (section 2.1) can't call Plaid without one — it has to live somewhere, and `Connection` is the only per-Item record. Decision: store it as `accessToken` on `Connection`, `select: false` on the Mongoose schema so it's excluded from every query by default; `ConnectionRepository.findByIdWithAccessToken()` is the sole read path, used only by the provider-sync job. This is a bearer credential, not account data, but sensitive for the same reason section 5 calls out account/routing numbers — it should be in scope for SEC-1's field-level encryption before this ever holds a real token, not just app-level `select: false`.
- **ADR-0017 — `FinancialProvider.createLinkToken()` added to the §2.1 interface.** The original interface sketch (section 2.1) started at `createConnection`, implicitly assuming a `public_token` already exists — but AGENTS.md requires every Plaid call, including Link initialization, to go through this interface, and Plaid Link needs a server-issued `link_token` before the frontend can even open. Decision: add `createLinkToken(input: { userId }): Promise<{ linkToken }>` to the interface, implemented by `PlaidProvider` via `linkTokenCreate` with `transactions.days_requested` fixed at 30 (ADR-0002) so the cap can't be bypassed by a caller. Also formalizes `verifyWebhook` as `Promise<boolean>` rather than the sketch's synchronous `boolean`, since JWK-based webhook signature verification (section 5) requires an async key fetch.
- **ADR-0018 — Session-based authentication, not a shared token or reverse-proxy Basic Auth.** Section 4/5 called this "a private single-user dashboard behind auth" without ever deciding what that means, and `ING-3`'s Link routes need a real "current user" per request to move forward. Considered a single shared `API_TOKEN` bearer secret (simplest, but doesn't scale past one identity — no way to tell two people apart or revoke one without rotating it for both) and reverse-proxy Basic Auth (keeps the app itself auth-free, but same one-identity limit and no real login/logout UX). Decision: a `User` collection (`packages/db`) with bcrypt-hashed passwords, `packages/api` sessions backed by Redis (`@fastify/session` + `@fastify/cookie`, `connect-redis` as the store — Redis is already in the stack for BullMQ) — a `requireAuth` preHandler hook gates every route except `/api/auth/*` and the Plaid webhook receiver. `POST /api/auth/register` only succeeds when zero users exist yet (bootstrap) or the caller is already authenticated, so a second person can be added later without opening public signup. This is real work the "one shared secret" options aren't — a new `AUTH` epic (`BACKLOG.md`) covers it — but it's the only option that doesn't need redoing if a second login is ever wanted, which was the deciding factor over the lighter options.
- **ADR-0019 — Workspace packages run from source via `tsx`, no per-package build step.** `apps/api` needing to actually import `packages/db`/`packages/providers` at runtime (rather than just typecheck against them) surfaced a gap: neither package's `package.json` declared a `main`/`exports` entry, and there was no build pipeline wiring `tsc`'s `outDir: dist` output into what a consumer would resolve. Considered adding a real per-package build step (`tsc` to `dist`, referenced via project references or Turborepo pipeline ordering) — more correct for a package meant to be published or consumed by unrelated projects, but this monorepo has neither: every consumer is another workspace in the same repo, built and run together. Decision: give `packages/db`/`packages/providers` an `"exports"` field pointing straight at `src/index.ts`, and run `apps/api` (via `pnpm dev`/the Docker `CMD`) with `tsx`, which transpiles TypeScript/ESM on the fly, including across workspace symlinks. Matches ADR-0003's operational-simplicity bias; revisit if a package is ever published standalone or a real production bundle/minification pass is wanted.
- **ADR-0020 — `Transaction.category` is app-owned, written with `$setOnInsert` on sync.** Building the sync job (ING-4) surfaced a conflict the schema didn't resolve: `category` is required on every `Transaction`, so the sync job must supply one, but the sync job also re-upserts a transaction on every Plaid `modified` event (an amount correction, a pending→posted flip). With a plain `$set`, each of those would reset a transaction that Tier 1/2/3 had already categorized — or that the user had just manually corrected in the Tier 4 review queue — back to the sync job's placeholder. Decision: `category` is the one field on this document the app owns rather than the provider. `TransactionRepository.upsertFromSync()` applies it via `$setOnInsert` so it lands only on first write; `updateCategory()` is the sole path for changing it afterward. The sync job's placeholder is `{ tier: 4, value: "Uncategorized", status: "needs_review" }` — an honest description of an un-categorized transaction that routes it into the review queue (§2.3) and is claimed automatically once CAT-3/CAT-4 land, rather than a fake "confirmed" category.
- **ADR-0021 — `RawPayloadRepository` added to the §3.3 repository set, insert-only.** §3.1 requires the untouched provider response to be stored alongside the cleaned `Transaction`, and DATA-4 built the schema, but DATA-9 named only four repositories (Connection/Account/Transaction/Rollup) — leaving nothing able to write the collection §3.1 depends on. Decision: add `RawPayloadRepository` with `insert()` and `findByProviderId()` and no update or delete method, so the append-only property §3.1's auditability and replay-ability guarantees rest on is enforced by the repository's surface rather than by convention. The sync job writes the raw payload *before* normalizing, so a transaction rejected downstream (e.g. an unresolvable account) is still recoverable and replayable.
- **ADR-0022 — Provider-sync idempotency via BullMQ `jobId` dedup, not a Redis mutex.** §2.2 offered either; ING-5 needed a concrete choice. Decision: a per-connection `jobId` of `sync-{connectionId}`, set by the single shared `enqueueProviderSync()` helper so no trigger can skip it. (§2.2 sketches this id with a colon; BullMQ rejects that outright — `Custom Id cannot contain :` — because colons are its Redis key separator, so the separator is a hyphen. The first end-to-end run caught this, after unit tests had asserted the broken value and typecheck had no opinion.) A Redis mutex was rejected as redundant: BullMQ already guarantees one worker per job, and — more to the point — every write in the drain is idempotent by construction (transactions upsert on `providerTransactionId`, the cursor is persisted per page, duplicate `RawPayload` rows are explicitly fine per §3.1). The lock therefore exists to avoid wasted API calls and cursor thrash, not to prevent corruption, which makes the cheaper mechanism sufficient. **The trap this hides:** BullMQ resolves `jobId` collisions against jobs it still retains, *including completed and failed ones* — so `removeOnComplete`/`removeOnFail` must both be `true`, or the very first sync for a connection would permanently block every later one. History comes from logs and `Connection.status` (ING-10) instead of BullMQ's retained sets. **Known limitation, accepted:** a trigger arriving while a drain for that connection is already running is swallowed rather than queued behind it. The drain runs to `hasMore: false`, so it already collects anything the provider held when it started; only data landing after its final page waits, and ING-8's scheduled poll bounds that wait. If webhook-to-dashboard latency ever matters more than it does now, the fix is a coalescing flag (re-enqueue once at completion if a trigger arrived mid-run), not a switch to mutexes.
- **ADR-0023 — Provider failures are translated into a neutral error taxonomy at the adapter boundary.** The sync job must treat "slow down" (429), "this connection needs re-auth" (ING-10), and "your cursor is stale" (ING-11) as three different situations, but AGENTS.md keeps Plaid specifics inside the adapter — so the worker cannot switch on `error_code` or reach into an axios response without violating that boundary. Decision: `packages/providers/src/errors.ts` defines a `ProviderError` hierarchy that every adapter maps its own failures onto (`ProviderRateLimitError` first, carrying `Retry-After`); the mapping itself is a pure function (`mapPlaidError`) so it can be unit-tested against hand-built error shapes without the SDK. Unrecognized errors are rethrown **unchanged** rather than wrapped, preserving their stack and message — the taxonomy exists to make specific cases actionable, not to flatten everything into a generic wrapper. Members are added when a story consumes them, not speculatively.
- **ADR-0024 — `FinancialProvider.parseWebhook()` added to the §2.1 interface.** ING-7's receiver has to decide whether an inbound webhook means "sync this connection" or "nothing to do", which in raw form means reading Plaid's `webhook_type`/`webhook_code` — exactly the provider-specific naming AGENTS.md and ADR-0004 keep inside the adapter. Decision: add `parseWebhook(body: unknown): ProviderWebhookEvent`, reducing a verified body to a neutral discriminated union (`sync_updates_available` today; ING-10 adds `item_error`). Total by contract — malformed or unrecognized bodies return `ignored` with a human-readable reason rather than throwing — because the input arrives from the public internet, where a bad body is an ordinary case and an exception would just become a 500. The implementation (`parsePlaidWebhook`) is pure, so the mapping is unit-tested without an HTTP server. **Related routing decision:** the receiver answers `200` for a verified-but-unactionable webhook (unknown code, or an Item we hold no `Connection` for) and `401` only for failed verification. Plaid retries non-2xx responses, so returning an error for something that will never succeed just buys a retry storm.
- **ADR-0025 — The scheduled fallback poll gets its own queue, not a repeatable job on `provider-sync`.** §2.2 describes the safety-net poll as "a scheduled BullMQ repeatable job" without saying where it lives, and ING-8 needed a concrete answer. Putting it on `provider-sync` would mean that queue carried two unrelated job shapes — a per-connection drain keyed `sync:{connectionId}`, and a connectionless fan-out — forcing the payload into a union and the handler into a branch, and letting a slow drain block the sweep that schedules more drains. Decision: a fifth queue, `provider-sync-scheduler`, whose only job lists syncable connections and enqueues normal `provider-sync` jobs through ING-5's shared helper — so a poll landing on a connection a webhook already queued collapses onto the same job rather than racing it. The schedule is registered with `upsertJobScheduler` under a fixed id, making worker restarts idempotent instead of stacking duplicate schedules. The poll's work list comes from the database at run time, not from the schedule, so a newly linked connection is picked up without re-registering anything.
