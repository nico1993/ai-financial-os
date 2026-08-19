# Personal Financial OS — Backlog

Stories grouped by epic, derived from `ARCHITECTURE.md`. Each story is a checklist item; check them off as they land. IDs (`SETUP-1`, `ING-3`, etc.) are stable references for commit messages, PR titles, or code comments — cheap to reference without a full task tracker.

**TDD convention:** for any story implementing a pure logic function (categorization resolvers, transfer-matching, rollup bucket-tracking, sync pagination), write the test first. Stories that primarily wire a pure function into a queue/route are thin by design and need less test investment than the logic they call.

## Suggested Sequencing

Epics have real dependencies — this is the order that avoids building on top of nothing:

1. **SETUP** — nothing else can start without the monorepo, tooling, and a Docker Compose skeleton in place.
2. **DATA** — schemas and the repository layer come before anything that needs to persist or query data.
3. **ING** — ingestion needs DATA's schemas to write into.
4. **CAT** — categorization needs ING's transactions to categorize.
5. **XFER** — transfer matching needs CAT's category signals (`TRANSFER_*`) to find candidates.
6. **ANLY** — dashboards need ING + CAT + XFER's data to be meaningful (cash flow needs `excludeFromCashFlow` from XFER, categories from CAT, transactions from ING).
7. **SEC** — baseline network/secrets posture belongs in SETUP; the items listed under SEC here are the ones worth deferring slightly (encryption at rest, backups) since they don't block functional development, but shouldn't slip past Phase 1 sign-off.

---

## Epic: SETUP — Repo & Tooling Foundation

- [x] **SETUP-1** — Scaffold pnpm + Turborepo monorepo: `apps/{web,api,worker}`, `packages/{db,providers,shared,config}` (section 7.1).
- [ ] **SETUP-2** — Shared `tsconfig.base.json` in `packages/config` — `strict: true`, `noUncheckedIndexedAccess` — extended by every workspace (section 7.3).
- [ ] **SETUP-3** — Shared ESLint + Prettier config in `packages/config`: `typescript-eslint` base, `eslint-plugin-react`/`eslint-plugin-react-hooks` for `apps/web`, plain Node/TS ruleset for `apps/api` and `apps/worker` (section 7.4).
- [ ] **SETUP-4** — Husky + lint-staged: lint and format on every commit.
- [ ] **SETUP-5** — Vitest configured per workspace with a shared base config in `packages/config` (section 7.5).
- [ ] **SETUP-6** — GitHub Actions CI workflow: lint + typecheck + test on every push.
- [ ] **SETUP-7** — Docker Compose skeleton: containers for `web`, `api`, `worker`, MongoDB, Redis, reverse proxy — no app logic yet, just scaffolding and healthchecks (section 5).
- [ ] **SETUP-8** — `.env.example` + secrets-loading convention documented (dotenv for dev; Docker secrets / mounted file for prod).
- [ ] **SETUP-9** — Reverse proxy (Caddy/Traefik) config: TLS termination, routing to `web`/`api`; confirm Mongo/Redis are bound to the Docker internal network only.
- [ ] **SETUP-10** — `README.md`: quick orientation — setup steps, repo layout, how to run locally.

## Epic: DATA — Data Model & Persistence

- [ ] **DATA-1** — `Connection` schema (`packages/db`) (section 3.2).
- [ ] **DATA-2** — `Account` schema.
- [ ] **DATA-3** — `Transaction` schema, including `category`, `transferGroupId`, `excludeFromCashFlow`, `isRemoved`.
- [ ] **DATA-4** — `RawPayloads` schema (insert-only, `source`/`type` discriminator) (section 3.1).
- [ ] **DATA-5** — `MerchantRules` schema (Tier 1/2 rules, `priority` field).
- [ ] **DATA-6** — `DailyBalanceSnapshot` / `MonthlyRollup` schemas.
- [ ] **DATA-7** — `Subscriptions` schema.
- [ ] **DATA-8** — Apply the six indexes from section 3.2 (`userId+date`, `userId+category.value+date`, `providerTransactionId` unique, `accountId+date`, `userId+category.status`, `transferGroupId` sparse).
- [ ] **DATA-9** — Repository layer: `ConnectionRepository`, `AccountRepository`, `TransactionRepository`, `RollupRepository` with domain-shaped methods (`upsertFromSync()`, `findByUserAndDateRange()`, `getMonthlyRollup()`) — no raw driver calls outside repositories (section 3.3, ADR-0005).
- [ ] **DATA-10** — Integration tests for repositories and aggregation pipelines using `mongodb-memory-server`, written alongside each repository method.

## Epic: ING — Data Ingestion & Provider Abstraction

- [ ] **ING-1** — `FinancialProvider` interface in `packages/providers` (section 2.1, ADR-0004).
- [ ] **ING-2** — `PlaidProvider` adapter implementing `FinancialProvider`.
- [ ] **ING-3** — Plaid Link flow: public token exchange, `Connection` creation, initial `Account` fetch, 30-day backfill via `days_requested` (ADR-0002).
- [ ] **ING-4** — `provider-sync` BullMQ queue + job handler: cursor-based pagination loop, cursor persisted after each page (section 2.2).
- [ ] **ING-5** — Idempotency lock per `connectionId` (Redis lock or BullMQ `jobId` dedup).
- [ ] **ING-6** — Rate limiting + retry/backoff config on the `provider-sync` queue (429 handling).
- [ ] **ING-7** — Plaid webhook receiver (`apps/api`): `SYNC_UPDATES_AVAILABLE` triggers a `provider-sync` job; verify webhook JWT signatures.
- [ ] **ING-8** — Scheduled fallback repeatable job (poll every 4–6h) as a webhook-miss safety net.
- [ ] **ING-9** — Pending→posted reconciliation: soft-delete/link the pending record when its posted counterpart arrives (section 6).
- [ ] **ING-10** — Item error-state handling: detect `ITEM_LOGIN_REQUIRED`, mark `Connection.status`, stop retrying until the user re-auths (section 6).
- [ ] **ING-11** — Cursor-drift handling: detect `PLAID_ERROR` on a stale cursor, explicit reset-and-full-resync path (section 6).
- [ ] **ING-12** — Unit tests for the sync job's pure logic (pagination/cursor handling, pending/posted merge logic), written first.

## Epic: CAT — Categorization Pipeline

- [ ] **CAT-1** — Tier 1 exact-match resolver (pure function): lookup against `MerchantRules` by normalized merchant string (section 2.3).
- [ ] **CAT-2** — Tier 2 regex/fuzzy resolver (pure function): priority-ordered rule evaluation + fuzzy matching against previously-corrected merchants.
- [ ] **CAT-3** — Wire Tier 1 + Tier 2 inline into the sync job (no queue overhead).
- [ ] **CAT-4** — `categorize-llm` BullMQ queue + job handler: batched OpenAI calls (20–50 tx/batch), structured JSON output schema, own concurrency/rate limiter.
- [ ] **CAT-5** — LLM confidence threshold + `uncertain` flag handling → `needs_review` status.
- [ ] **CAT-6** — Write-back loop: cache confirmed LLM/manual decisions into the Tier 1 `MerchantRules` table.
- [ ] **CAT-7** — Tier 4 review queue UI (`apps/web`): list `needs_review` transactions, manual category correction, triggers write-back.
- [ ] **CAT-8** — Unit tests for the Tier 1/2 resolvers and the LLM response-parsing/confidence logic, written first.

## Epic: XFER — Transfer Matching (Cross-Account Reconciliation)

- [ ] **XFER-1** — Transfer-matching candidate logic (pure function): opposite-signed, same-magnitude, `TRANSFER_*` category, date-tolerance window (section 2.4, ADR-0006).
- [ ] **XFER-2** — `transfer-matching` BullMQ job: runs after categorization completes for a sync batch, scoped to the user's own accounts.
- [ ] **XFER-3** — Apply a match: set `transferGroupId` + `excludeFromCashFlow` on both sides.
- [ ] **XFER-4** — Age unmatched `TRANSFER_*` transactions into the Tier 4 review queue after a configurable window.
- [ ] **XFER-5** — Emit the affected-date-bucket signal for rollup recompute (feeds ANLY-2).
- [ ] **XFER-6** — Unit tests for the matching heuristic — synthetic transaction pairs, edge cases (fees, same-day duplicates), written first.

## Epic: ANLY — Analytics & Dashboard

- [ ] **ANLY-1** — Rollup job: `DailyBalanceSnapshot` + `MonthlyRollup` via `$merge`, triggered post-sync and by transfer-matching (section 4.4).
- [ ] **ANLY-2** — Targeted, bucket-scoped recompute shared by the sync job and the transfer-matching job (ADR-0008).
- [ ] **ANLY-3** — Net Worth API endpoint: reads `DailyBalanceSnapshot`, handles partial-history gap rendering.
- [ ] **ANLY-4** — Monthly Cash Flow API endpoint: `excludeFromCashFlow` filter applied.
- [ ] **ANLY-5** — Categorical Spending Distribution API endpoint (on-demand aggregation).
- [ ] **ANLY-6** — Comparison-range (`$facet`) support: `range` + `compareRange` params on relevant endpoints.
- [ ] **ANLY-7** — Subscription-detection heuristic: nightly batch job, interval clustering, writes to `Subscriptions`.
- [ ] **ANLY-8** — SSE `/events` route (`apps/api`): BullMQ `QueueEvents` listener, `sync.completed` / `transfer.matched` events (section 4.3, ADR-0007).
- [ ] **ANLY-9** — Frontend feature folders: net-worth, cash-flow, spending-categories, subscriptions, review-queue (React Query hooks + Recharts/Chart.js components).
- [ ] **ANLY-10** — SSE client (`apps/web`): invalidate relevant React Query caches on event receipt, background-refetch fallback.
- [ ] **ANLY-11** — Net-worth chart gap-rendering for accounts with partial backfill history.
- [ ] **ANLY-12** — Integration tests for aggregation pipelines (`$dateTrunc`, `$merge`, `$facet`) via `mongodb-memory-server`.

## Epic: SEC — Security & Self-Hosting (deferred-but-not-skippable items)

- [ ] **SEC-1** — Field-level encryption for sensitive fields (account/routing numbers, raw payloads) — CSFLE or application-level AES-GCM.
- [ ] **SEC-2** — Scheduled `mongodump` backup to encrypted, off-box storage.
- [ ] **SEC-3** — Confirm Plaid webhook JWT signature verification is in place (cross-check against ING-7).
- [ ] **SEC-4** — Docker network posture audit: confirm Mongo/Redis have no host-exposed ports, only the reverse proxy does.
- [ ] **SEC-5** — Secrets audit: confirm no credentials are baked into images, `.env` is git-excluded, and production uses Docker secrets or a mounted file.

---

## Explicitly Out of Scope (Phase 1)

- Budgeting math (burn-rate, allowance logic) — deferred per `ARCHITECTURE.md` section 0.
- FX conversion / multi-currency support — ADR-0001, revisit only if a foreign-currency account is linked.
- Full historical backfill (>30 days) — ADR-0002, planned as an explicit user-triggered action later, not a Phase 1 story.
