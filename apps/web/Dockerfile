# Scaffolding only (SETUP-7) — apps/web has no real Vite/React app yet,
# just the SETUP-1 placeholder (src/index.ts). ARCHITECTURE.md §7.2 calls
# for web to ultimately be a static build served without a Node runtime
# (no SSR, no server-side logic) — once ANLY-9 adds the real Vite app, this
# should become a multi-stage build (`pnpm build` → static files served by
# Caddy directly, or an nginx stage) instead of running a dev server
# container. Kept as a Node dev-server container for now since there's no
# static build to produce yet.
FROM node:22-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
COPY . .
WORKDIR /repo/apps/web
EXPOSE 5173
# TODO: replace with a static build + file server once apps/web has a real
# Vite app (ANLY-9) — this just runs the SETUP-1 placeholder "dev" script
# today, and Vite's dev server isn't what should ship in production.
CMD ["pnpm", "dev"]
