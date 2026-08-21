# See apps/api/Dockerfile for the rationale behind this layer shape;
# worker and api are deliberately built the same way so a stuck job can be
# restarted without touching api.
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
# No build/dist step -- runs straight from TS source via tsx (ADR-0019).
CMD ["pnpm", "start"]
