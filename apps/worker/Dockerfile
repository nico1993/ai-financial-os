# Scaffolding only (SETUP-7) — apps/worker has no real BullMQ processors
# yet, just the SETUP-1 placeholder (src/index.ts). See apps/api/Dockerfile
# for the rationale behind this layer shape; worker and api are deliberately
# built the same way so a stuck job can be restarted without touching api.
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
WORKDIR /repo/apps/worker
# No EXPOSE — this is a background queue processor, not an HTTP service.
# TODO: swap for a real start command once apps/worker has actual BullMQ
# queue processors (ING-4 onward) — this just runs the SETUP-1 placeholder
# "dev" script today.
CMD ["pnpm", "dev"]
