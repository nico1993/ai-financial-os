# Personal Financial OS — Agent Instructions

Self-hosted personal finance app: Plaid ingestion + analytics dashboard. Solo project (one user, no multi-tenant concerns). Budgeting math is explicitly out of scope for this phase.

**Source of truth — read these before doing anything else:**
- `ARCHITECTURE.md` — full design: ingestion, categorization pipeline, data model, analytics, security, tech stack, and an ADR-numbered decision log explaining why each call was made.
- `BACKLOG.md` — the implementation backlog: epics, ordered stories, sequencing rationale.

Don't restate or duplicate either doc here. If something you need isn't covered by them, that's a gap to raise, not to improvise around.

## Repo Layout

```
/apps
  /web        Vite + React SPA (dashboard UI)
  /api        Fastify (all HTTP routes, Plaid webhook, SSE)
  /worker     BullMQ queues (provider-sync, categorize-llm, transfer-matching, rollups)
/packages
  /db         Mongoose schemas + repository layer
  /providers  FinancialProvider interface + PlaidProvider adapter
  /shared     Shared TS types/constants
  /config     Shared tsconfig, eslint, prettier config
```

## Commands

- Install: `pnpm install`
- Build everything: `pnpm turbo run build`
- Test everything: `pnpm turbo run test`
- Lint + typecheck: `pnpm turbo run lint typecheck`
- Run one workspace's tests: `pnpm --filter <app-or-package> test`
- Dev servers: `pnpm --filter apps/web dev`, `pnpm --filter apps/api dev`, `pnpm --filter apps/worker dev`

## Workflow

- Work `BACKLOG.md` one story at a time, in the epic order it specifies (SETUP → DATA → ING → CAT → XFER → ANLY, SEC woven in as noted). Don't jump ahead — later stories assume earlier ones exist.
- For pure-logic stories (categorization resolvers, transfer-matching, cursor pagination, rollup bucket-tracking — see `ARCHITECTURE.md` §7.5), write the failing test first, then implement. Thin wiring/glue code doesn't need test-first.
- On completing a story: run its tests, check the box in `BACKLOG.md`, commit with the story ID in the message (e.g. `git commit -m "SETUP-1: scaffold monorepo"`).
- If a decision isn't already resolved in `ARCHITECTURE.md`, stop and ask rather than deciding silently. If we resolve it together, add it as a new ADR in `ARCHITECTURE.md` §8, not just in code comments.
- Report progress after each story or small batch — don't run silently through large chunks of the backlog unattended.

## Conventions (things that differ from tool defaults — check `ARCHITECTURE.md` for full rationale)

- Money is always integer cents, never float or Decimal128.
- Dates are stored as UTC `Date` objects; Plaid's `date` field is a calendar date, not a timestamp — don't round-trip it through timezone conversion on display.
- No direct Mongo driver calls outside `packages/db`'s repository layer.
- All Plaid access goes through the `FinancialProvider` interface in `packages/providers` — never call the Plaid SDK directly from `apps/api` or `apps/worker`.
- `apps/web` is client-rendered only — no SSR.

## Model Guidance

Default to Sonnet at its default effort for most stories. Switch to Opus for `ING-4`, `ING-9`, `ING-10`, `ING-11`, `XFER-1`, and `ANLY-2` — these have real algorithmic/edge-case subtlety per `ARCHITECTURE.md`.
