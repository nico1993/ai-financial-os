# Scaffolding only (SETUP-7) — apps/api has no real Fastify server yet,
# just the SETUP-1 placeholder (src/index.ts). This wires a working pnpm
# workspace install inside the image now, so later stories (ING-*, ANLY-*)
# add real app code without retrofitting the container.
#
# Manifests are copied and installed before the rest of the source so
# `pnpm install` is cached across builds unless a package.json actually
# changed — the point of the workspace-wide monorepo layer below.
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
WORKDIR /repo/apps/api
EXPOSE 3000
# TODO: swap for a real start command (e.g. `pnpm build && node dist/index.js`)
# once apps/api has an actual Fastify server — this just runs the SETUP-1
# placeholder "dev" script today.
CMD ["pnpm", "dev"]
