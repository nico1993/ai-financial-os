# Personal Financial OS

Self-hosted personal finance app: Plaid ingestion + analytics dashboard. Solo project — one user, no multi-tenant concerns, budgeting math out of scope for this phase.

Full design (data model, ingestion pipeline, categorization, analytics, security posture, and the ADR-numbered decision log) lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md). The implementation plan lives in [`BACKLOG.md`](./BACKLOG.md). This file is just quick orientation — how to get it running.

**Current status:** early scaffolding. The monorepo, tooling, and Docker topology are wired up; `apps/{web,api,worker}` don't have real app logic yet. Check `BACKLOG.md` for what's done and what's next.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io) (version pinned in `package.json`'s `packageManager` field — run via `corepack enable` to get the right one automatically)
- [Docker](https://www.docker.com/) + Docker Compose, if you want to run the full stack (Mongo, Redis, reverse proxy included) rather than just the workspaces directly

## Quick start

```bash
git clone <this repo>
cd ai-financial-os
cp .env.example .env   # fill in Plaid/OpenAI credentials — see "Secrets" below
pnpm install
```

From there, two ways to run it:

**Workspaces directly** (fastest for day-to-day development — no Mongo/Redis/proxy):

```bash
pnpm --filter @financial-os/web dev
pnpm --filter @financial-os/api dev
pnpm --filter @financial-os/worker dev
```

**Full stack via Docker Compose** (matches the self-hosted deployment shape — see `ARCHITECTURE.md` §5):

```bash
docker compose up --build
```

## Repo layout

```
/apps
  /web        Vite + React SPA — dashboard UI, client-rendered only
  /api        Fastify — HTTP routes, Plaid webhook receiver, SSE stream
  /worker     BullMQ queues: provider-sync, categorize-llm, transfer-matching, rollups
/packages
  /db         Mongoose schemas + the repository layer
  /providers  FinancialProvider interface + PlaidProvider adapter
  /shared     Shared TS types/constants
  /config     Shared tsconfig, ESLint, Prettier, and Vitest config
/proxy        Caddy reverse-proxy config
```

Full rationale for this shape is in `ARCHITECTURE.md` §7.

## Common commands

Run from the repo root; `turbo` fans each one out across every workspace.

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `pnpm build`        | Build every workspace                 |
| `pnpm dev`          | Run every workspace's dev server      |
| `pnpm lint`         | ESLint across every workspace         |
| `pnpm typecheck`    | `tsc --noEmit` across every workspace |
| `pnpm test`         | Vitest across every workspace         |
| `pnpm format`       | Prettier, write mode, whole repo      |
| `pnpm format:check` | Prettier, check mode (what CI runs)   |

A pre-commit hook (Husky + lint-staged) runs lint and format automatically on every commit — see `.lintstagedrc.mjs`.

To run a command for just one workspace: `pnpm --filter <app-or-package> <script>` (e.g. `pnpm --filter @financial-os/api test`).

## Secrets

`.env` is git-ignored — copy `.env.example` and fill in real values locally. See the comments in `.env.example` for what each variable is.

**In production**, prefer Docker secrets or a mounted secrets file over an `.env` file baked into an image — `.env` is fine for local development, but real Plaid/OpenAI/Mongo credentials shouldn't ship inside a container image or sit in plaintext on a host filesystem indefinitely. `docker-compose.yml`'s `env_file: .env` wiring is meant for local/dev use; swap it for [Docker secrets](https://docs.docker.com/compose/how-tos/use-secrets/) (or an equivalent mounted, permission-restricted file read at startup) when deploying for real. See `ARCHITECTURE.md` §5 for the full privacy/self-hosting posture, including field-level encryption and network isolation for Mongo/Redis.

## CI

Every push and PR runs lint, typecheck, and test via GitHub Actions (`.github/workflows/ci.yml`).
