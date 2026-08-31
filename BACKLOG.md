# Personal Financial OS — Backlog

Stories grouped by epic, derived from `ARCHITECTURE.md`. Each story is a checklist item; check them off as they land. IDs (`SETUP-1`, `ING-3`, etc.) are stable references for commit messages, PR titles, or code comments — cheap to reference without a full task tracker.

**TDD convention:** for any story implementing a pure logic function (categorization resolvers, transfer-matching, rollup bucket-tracking, sync pagination), write the test first. Stories that primarily wire a pure function into a queue/route are thin by design and need less test investment than the logic they call.

## Suggested Sequencing

Epics have real dependencies — this is the order that avoids building on top of nothing:

1. **SETUP** — nothing else can start without the monorepo, tooling, and a Docker Compose skeleton in place.
2. **DATA** — schemas and the repository layer come before anything that needs to persist or query data.
3. **AUTH** — `apps/api` needs a real "current user" per request before any route (starting with ING-3's Link routes) can be written correctly (ADR-0018).
4. **ING** — ingestion needs DATA's schemas to write into, and AUTH's `requireAuth` to know whose data it's writing.
5. **CAT** — categorization needs ING's transactions to categorize.
6. **XFER** — transfer matching needs CAT's category signals (`TRANSFER_*`) to find candidates. _Correction (ADR-0029): the actual signal is `Transaction.providerCategory`, Plaid's raw field set at sync time -- not any CAT-9 taxonomy value. XFER-2 still chains off categorize-llm's completion to keep the documented pipeline order, not because matching needs Tier 1-4's output._
7. **WEB** — `apps/web` is still SETUP-1's empty stub (package.json/tsconfig/eslint config, no framework, no pages). Bootstrap the application shell -- framework, routing, API client, auth guard, design system -- before any dashboard or review-queue page can be built on top of it. Only depends on AUTH's session contract (ADR-0018) being real, not on ANLY's data existing yet, so it can proceed in parallel with (or right after) the backend work above.
8. **ANLY** — dashboards need ING + CAT + XFER's data (backend) and WEB's application shell (frontend) to be meaningful (cash flow needs `excludeFromCashFlow` from XFER, categories from CAT, transactions from ING, a page to render into from WEB).
9. **SEC** — baseline network/secrets posture belongs in SETUP; the items listed under SEC here are the ones worth deferring slightly (encryption at rest, backups) since they don't block functional development, but shouldn't slip past Phase 1 sign-off.

---

## Epic: SETUP — Repo & Tooling Foundation

- [x] **SETUP-1** — Scaffold pnpm + Turborepo monorepo: `apps/{web,api,worker}`, `packages/{db,providers,shared,config}` (section 7.1).
- [x] **SETUP-2** — Shared `tsconfig.base.json` in `packages/config` — `strict: true`, `noUncheckedIndexedAccess` — extended by every workspace (section 7.3).
- [x] **SETUP-3** — Shared ESLint + Prettier config in `packages/config`: `typescript-eslint` base, `eslint-plugin-react`/`eslint-plugin-react-hooks` for `apps/web`, plain Node/TS ruleset for `apps/api` and `apps/worker` (section 7.4).
- [x] **SETUP-4** — Husky + lint-staged: lint and format on every commit.
- [x] **SETUP-5** — Vitest configured per workspace with a shared base config in `packages/config` (section 7.5).
- [x] **SETUP-6** — GitHub Actions CI workflow: lint + typecheck + test on every push.
- [x] **SETUP-7** — Docker Compose skeleton: containers for `web`, `api`, `worker`, MongoDB, Redis, reverse proxy — no app logic yet, just scaffolding and healthchecks (section 5).
- [x] **SETUP-8** — `.env.example` + secrets-loading convention documented (dotenv for dev; Docker secrets / mounted file for prod).
- [x] **SETUP-9** — Reverse proxy (Caddy/Traefik) config: TLS termination, routing to `web`/`api`; confirm Mongo/Redis are bound to the Docker internal network only.
- [x] **SETUP-10** — `README.md`: quick orientation — setup steps, repo layout, how to run locally.

## Epic: DATA — Data Model & Persistence

- [x] **DATA-1** — `Connection` schema (`packages/db`) (section 3.2).
- [x] **DATA-2** — `Account` schema.
- [x] **DATA-3** — `Transaction` schema, including `category`, `transferGroupId`, `excludeFromCashFlow`, `isRemoved`.
- [x] **DATA-4** — `RawPayloads` schema (insert-only, `source`/`type` discriminator) (section 3.1).
- [x] **DATA-5** — `MerchantRules` schema (Tier 1/2 rules, `priority` field).
- [x] **DATA-6** — `DailyBalanceSnapshot` / `MonthlyRollup` schemas.
- [x] **DATA-7** — `Subscriptions` schema.
- [x] **DATA-8** — Apply the six indexes from section 3.2 (`userId+date`, `userId+category.value+date`, `providerTransactionId` unique, `accountId+date`, `userId+category.status`, `transferGroupId` sparse).
- [x] **DATA-9** — Repository layer: `ConnectionRepository`, `AccountRepository`, `TransactionRepository`, `RollupRepository` with domain-shaped methods (`upsertFromSync()`, `findByUserAndDateRange()`, `getMonthlyRollup()`) — no raw driver calls outside repositories (section 3.3, ADR-0005). _`RawPayloadRepository` was missing from this list even though §3.1 requires the collection to be written; added during ING-4, see ADR-0021._
- [x] **DATA-10** — Integration tests for repositories and aggregation pipelines using `mongodb-memory-server`, written alongside each repository method.

## Epic: AUTH — Session-Based Authentication (ADR-0018)

- [x] **AUTH-1** — `User` schema (`packages/db`): `email` (unique), `passwordHash` (`select: false`); `UserRepository` with `create`/`findByEmail`/`findByEmailWithPassword`/`findById`/`count`.
- [x] **AUTH-2** — Redis-backed session plugin in `apps/api` (`@fastify/cookie` + `@fastify/session`, hand-written `RedisSessionStore` on top of `ioredis` rather than `connect-redis` — avoids betting on that package's exact version/typings for a ~30-line get/set/destroy store) — `httpOnly` cookie, `secure` in production.
- [x] **AUTH-3** — Auth routes: `POST /api/auth/register` (allowed only when zero users exist yet, or the caller is already authenticated), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
- [x] **AUTH-4** — `requireAuth` preHandler hook applied to every route except `/api/auth/*`, the Plaid webhook receiver (ING-7, verified via JWT instead), and `/health`.
- [ ] **AUTH-5** — `apps/web` login page + redirect-if-unauthenticated. Deferred until `apps/web` work starts — not needed to unblock the backend. _Implemented as part of WEB-4 (application shell), once the WEB epic bootstraps `apps/web`; this id stays here since it's the stable reference already used elsewhere._

## Epic: ING — Data Ingestion & Provider Abstraction

- [x] **ING-1** — `FinancialProvider` interface in `packages/providers` (section 2.1, ADR-0004).
- [x] **ING-2** — `PlaidProvider` adapter implementing `FinancialProvider`.
- [x] **ING-3** — Plaid Link flow: public token exchange, `Connection` creation, initial `Account` fetch, 30-day backfill via `days_requested` (ADR-0002).
- [x] **ING-4** — `provider-sync` BullMQ queue + job handler: cursor-based pagination loop, cursor persisted after each page (section 2.2).
- [x] **ING-5** — Idempotency lock per `connectionId` (Redis lock or BullMQ `jobId` dedup). _Chose `jobId` dedup via a single shared `enqueueProviderSync()` helper; see ADR-0022 for why a mutex was unnecessary, and for the `removeOnComplete` trap and the accepted mid-run-trigger limitation._
- [x] **ING-6** — Rate limiting + retry/backoff config on the `provider-sync` queue (429 handling). _Needed a provider-neutral error taxonomy first (ADR-0023) so a Plaid 429 could reach the worker without leaking `error_code`/axios details past the adapter._
- [x] **ING-7** — Plaid webhook receiver (`apps/api`): `SYNC_UPDATES_AVAILABLE` triggers a `provider-sync` job; verify webhook JWT signatures. _Needed a scoped raw-body parser (re-serializing Fastify's parsed JSON changes the bytes, so the signature hash never matches) and `FinancialProvider.parseWebhook()` (ADR-0024) to keep Plaid webhook codes out of the route._
- [x] **ING-8** — Scheduled fallback repeatable job (poll every 4–6h) as a webhook-miss safety net. _Own queue rather than a repeatable job on `provider-sync` (ADR-0025); work list read from the DB at run time, so newly linked connections need no re-registration._
- [x] **ING-9** — Pending→posted reconciliation: soft-delete/link the pending record when its posted counterpart arrives (section 6). _Also carries a real category across to the posted row, otherwise a manual Tier 4 correction is lost when the transaction settles, and records both date buckets since the pending row may sit in an earlier one._
- [x] **ING-10** — Item error-state handling: detect `ITEM_LOGIN_REQUIRED`, mark `Connection.status`, stop retrying until the user re-auths (section 6). _Handled on both paths (API error and ITEM webhook), splitting re-auth from revoked since the recoveries differ; raised as `UnrecoverableError` so BullMQ stops retrying immediately._
- [x] **ING-11** — Cursor-drift handling: detect `PLAID_ERROR` on a stale cursor, explicit reset-and-full-resync path (section 6). _Invalid-cursor (reset + resync from empty) kept distinct from mutation-during-pagination (restart the drain, keep the cursor); conflating them would force needless full resyncs._
- [x] **ING-12** — Unit tests for the sync job's pure logic (pagination/cursor handling, pending/posted merge logic), written first. _Pagination/cursor with ING-4; pending/posted and cursor-drift with ING-9/ING-11; provider error and webhook mapping alongside ING-6/ING-7. All written before their implementations._

## Epic: CAT — Categorization Pipeline

- [x] **CAT-1** — Tier 1 exact-match resolver (pure function): lookup against `MerchantRules` by normalized merchant string (section 2.3).
- [x] **CAT-2** — Tier 2 regex/fuzzy resolver (pure function): priority-ordered rule evaluation + fuzzy matching against previously-corrected merchants.
- [x] **CAT-3** — Wire Tier 1 + Tier 2 inline into the sync job (no queue overhead).
- [x] **CAT-4** — `categorize-llm` BullMQ queue + job handler: batched LLM calls (20–50 tx/batch) via a `CategorizationProvider` abstraction (ADR-0026, Ollama/`gpt-oss:20b` for Phase 1), structured JSON output schema, own concurrency limit.
- [x] **CAT-5** — LLM confidence threshold + `uncertain` flag handling → `needs_review` status (`categorize/tier3.ts`'s `resolveTier3Outcome()`).
- [x] **CAT-6** — Write-back loop: cache confirmed LLM decisions into the Tier 1 `MerchantRules` table (`MerchantRuleRepository.upsertExact()`, ADR-0027). The _manual_ half of "LLM/manual" stays open -- it has no caller until CAT-7's review queue UI exists.
- [ ] **CAT-7** — Tier 4 review queue UI (`apps/web`): list `needs_review` transactions, manual category correction, triggers write-back.
- [x] **CAT-8** — Unit tests for the Tier 1/2 resolvers and the LLM response-parsing/confidence logic, written first.
- [x] **CAT-9** — Richer/per-user category taxonomy. `DEFAULT_CATEGORIES` (`apps/worker/src/categorize/categories.ts`) is currently one fixed, app-owned list of 18 categories; running CAT-4/5 against real Plaid sandbox data (a CD deposit, a loan payment, an ambiguous employer-name credit) showed several transaction shapes with no good fit, correctly landing in `needs_review` rather than being miscategorized, but pointing at two real gaps: (1) the default list itself could use more categories/subcategories (loan payments, transfers, investments are the ones the sandbox run actually hit), and (2) categories are the same for every user with no way to add/rename/hide one. `CategorizationProvider.categorizeBatch(candidates, categories)` already takes `categories` as a plain `readonly string[]` with no opinion on its contents, so the interface doesn't need to change -- this is about where that list comes from (a DB collection per user instead of a hardcoded array) and the UI to manage it, likely alongside CAT-7's review queue. **Delivered:** the per-user DB collection half (`Category` model, `CategoryRepository`, lazy per-user seeding, ADR-0028) -- `categorize-llm` now reads a user's own editable category list instead of the shared constant. **Not delivered:** the taxonomy itself is still the same 18 names carried over unchanged (no new loan-payment/transfer/investment-specific categories added); a user can only get a richer list today by adding a custom category themselves via `CategoryRepository.create()`, since no route/UI calls it yet (CAT-7).
- [x] **CAT-10** — Category colors. Save a default color into the default categories model (CAT-9), changeable by the user; custom categories a user adds get the same treatment (a color field on the same per-user category record, set on creation and editable afterward).

## Epic: XFER — Transfer Matching (Cross-Account Reconciliation)

- [x] **XFER-1** — Transfer-matching candidate logic (pure function): opposite-signed, same-magnitude, `TRANSFER_*` category, date-tolerance window (section 2.4, ADR-0006). _Reads `Transaction.providerCategory` (ADR-0029, a new field), not the CAT-9 taxonomy -- see that ADR for why they're different signals. Deterministic greedy pairing (`apps/worker/src/transfer/matching.ts`)._
- [x] **XFER-2** — `transfer-matching` BullMQ job: runs after categorization completes for a sync batch, scoped to the user's own accounts. _Chains off `categorize-llm`'s completion (`triggerTransferMatching()`, called from `categorizeLlm.ts`), unconditional on whether that run confirmed anything -- matching only needs `providerCategory`, already set at sync time._
- [x] **XFER-3** — Apply a match: set `transferGroupId` + `excludeFromCashFlow` on both sides. _`TransactionRepository.applyTransferMatch()` was already built and tested ahead of this story landing; the job just generates a `crypto.randomUUID()` per pair and calls it._
- [x] **XFER-4** — Age unmatched `TRANSFER_*` transactions into the Tier 4 review queue after a configurable window (`XFER_UNMATCHED_AGE_DAYS`, default 3 days). Preserves the existing category value, just flips `tier`/`status` to `needs_review` -- idempotent across runs. _The manual "confirm external / pair it" actions this feeds still have no UI to call them from -- CAT-7/`apps/web`, the same deferred gap ADR-0027/ADR-0028 already flag._
- [x] **XFER-5** — Emit the affected-date-bucket signal for rollup recompute (feeds ANLY-2). _`TransferMatchingResult.touchedDayBuckets`/`.touchedMonthBuckets`, same shape/mechanism `SyncConnectionResult` already uses -- left deliberately unwired for ANLY-2, same as provider-sync's own signal._
- [x] **XFER-6** — Unit tests for the matching heuristic — synthetic transaction pairs, edge cases (fees, same-day duplicates), written first. _`apps/worker/src/transfer/matching.test.ts`, hand-traced against the implementation (vitest can't run in either sandbox this was built in -- AGENTS.md)._

## Epic: WEB — Frontend Application Foundation

`apps/web` today is exactly what SETUP-1 left it: a `package.json`, `tsconfig.json`, `eslint.config.js`, and `vitest.config.ts`, plus one placeholder `src/index.ts` -- no framework, no router, no pages. Three other backlog items are already waiting on this epic rather than each bootstrapping their own slice of it: AUTH-5 (login page), CAT-7 (Tier 4 review queue UI), and ANLY-9..11 (the actual dashboard pages). This epic is that one shared foundation, built once instead of three times.

- [x] **WEB-0** — Mock up the UI before writing any application code: 2-3 key screens (login, the dashboard shell/nav, one data-heavy page such as net worth or spending) as reviewable artboards via the `design` skill (Claude Design canvas), in a couple of candidate visual directions, so WEB-1/WEB-5's framework/token choices start from an agreed-on look instead of a guess. Not throwaway -- the direction picked here is what WEB-5 turns into real Tailwind/shadcn tokens. _Delivered as a single six-artboard canvas (login, dashboard overview, spending -- both directions): "Mockup A", grounded in the taste-skill's `minimalist-ui` + `design-taste-frontend-v1` sub-skills (warm monochrome, single terracotta accent, monospace figures for data; `design-taste-frontend` v2 was set aside -- it explicitly disclaims dashboards/product UI), against "Mockup B", shadcn/ui defaults on independent judgment with no taste-skill input (Inter, blue-600 primary, conventional shadcn chrome). Both share the same illustrative data and the same dataviz categorical palette. User picked Mockup A (2026-08-29); its palette/type/radii are now locked in as constants -- see WEB-5 and `apps/web/src/design/tokens.ts` (ADR-0030)._
- [x] **WEB-1** — Bootstrap `apps/web` as a Vite + React + TypeScript SPA (ADR-0011 already chose this over Next.js), with Tailwind CSS installed alongside it -- shadcn/ui (the chosen component foundation, WEB-5) is Tailwind + Radix primitives copied into the repo, not a normal npm UI-kit dependency, so Tailwind needs to be there from the start. Install the framework into the existing SETUP-1 stub, base `index.html`/entry point, real `dev`/`build` scripts replacing the current placeholder echoes. _Vite 8 + React 19 + Tailwind v4 (current stable majors, cross-checked against the npm registry and each other's peer ranges rather than assumed -- ADR-0031). Tailwind wired via `@tailwindcss/vite` + an `@config` directive pointing at `tailwind.config.ts`, which imports `src/design/tokens.ts` (ADR-0030) rather than re-typing values into CSS -- tokens.ts stays the one file WEB-5 (and anyone else) edits for a look change. `index.html`/`src/main.tsx`/`src/App.tsx` replace the SETUP-1 `src/index.ts` placeholder. **Not verified end-to-end**: `pnpm install` could not be run from this session's device shell (a Linux VM -- see ADR-0031's "trap" note); package.json's new deps were added by hand with registry-checked versions, so `tsc --noEmit` currently reports every new import as unresolved until you run `pnpm install` yourself and it's on you to confirm `pnpm --filter @financial-os/web dev` actually renders._
- [ ] **WEB-2** — Client-side routing -- pick a router and lay out the route table for every page this backlog already names: login (AUTH-5), net worth, cash flow, spending categories, subscriptions, and the review queue (CAT-7).
- [ ] **WEB-3** — API client + data-fetching layer: a typed fetch wrapper against `apps/api` with `credentials: 'include'` for AUTH-2's session cookie, a React Query provider, and shared 401 → redirect-to-login handling. ANLY-9's "React Query hooks" and ANLY-10's SSE-triggered cache invalidation both build on this rather than each rolling their own.
- [ ] **WEB-4** — Auth-guarded application shell: session bootstrap via `GET /api/auth/me`, a redirect-if-unauthenticated route wrapper, and the base layout (nav/header). This is AUTH-5's actual implementation -- see the cross-reference on that story.
- [ ] **WEB-5** — Design system foundation: shadcn/ui (Radix primitives + Tailwind, chosen over a black-box npm component kit because it copies component source into the repo -- easy to restyle every component to match whatever WEB-0 picks) as the component foundation, with color/typography/spacing tokens configured in Tailwind to match WEB-0's chosen mockup direction. Reuses the `dataviz` skill's already-validated categorical palette (`references/palette.md` -- the same one CAT-10's category colors cycle through) as the color foundation rather than picking a second, inconsistent system, so chart colors and UI chrome read as one system. _Design-skill pick, decided when this epic was opened: WEB-0's mockup pass uses the `design` skill (Claude Design canvas, already available) -- lightweight, no install, matched to a solo self-hosted app with no separate design team. The `design` marketplace plugin (design-critique/design-system/accessibility-review/design-handoff skills, plus Figma/Notion/Slack MCP servers) was evaluated and set aside for now: its accessibility-review and design-system skills could be worth adding later for an ongoing audit/token-management workflow, but the plugin's bundled MCP servers assume a team/Figma-file workflow this project doesn't have. Separately, the user installed the open-source `taste-skill` (tasteskill.dev, project-local, installed via `npx skills add Leonxlnx/taste-skill` rather than through the account skill system) as extra design guidance; WEB-0's Mockup A drew on its `minimalist-ui` and `design-taste-frontend-v1` sub-skills, and that direction is the one now locked in._ **Palette/typography locked in (2026-08-29):** Mockup A's colors, fonts, and radii are centralized as constants in `apps/web/src/design/tokens.ts` (ADR-0030) so WEB-1's Tailwind setup imports them into `theme.extend` rather than duplicating hex values -- change the look by editing that one file. Category colors are deliberately excluded from that file: they're already a solved, per-user, editable field (`Category.color`, ADR-0028), not a frontend constant.
- [ ] **WEB-6** — Component testing conventions for `apps/web`: React Testing Library wired into the existing `vitest.config.ts` stub (SETUP-5), extending AGENTS.md's test-first convention to the frontend's pure-enough logic (route guards, form validation) the same way it already applies to the backend's resolvers.

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
- [ ] **SEC-3** — Confirm Plaid webhook JWT signature verification is in place (cross-check against ING-7). _Implemented in ING-7; still needs an end-to-end check against a real Plaid-signed webhook, since the JWK path can only be exercised against live Plaid._
- [ ] **SEC-4** — Docker network posture audit: confirm Mongo/Redis have no host-exposed ports, only the reverse proxy does.
- [ ] **SEC-5** — Secrets audit: confirm no credentials are baked into images, `.env` is git-excluded, and production uses Docker secrets or a mounted file.

---

## Explicitly Out of Scope (Phase 1)

- Budgeting math (burn-rate, allowance logic) — deferred per `ARCHITECTURE.md` section 0.
- FX conversion / multi-currency support — ADR-0001, revisit only if a foreign-currency account is linked.
- Full historical backfill (>30 days) — ADR-0002, planned as an explicit user-triggered action later, not a Phase 1 story.
