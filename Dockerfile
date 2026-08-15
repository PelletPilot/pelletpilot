# PelletPilot self-host server. Build context = repo root (monorepo).
FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# install deps (workspace-aware)
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
RUN pnpm install --no-frozen-lockfile

# build protocol + server
COPY packages/protocol packages/protocol
COPY packages/server packages/server
RUN pnpm --filter @pelletpilot/protocol build \
    && pnpm --filter @pelletpilot/server build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_FILE=/data/pelletpilot.db
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/server
EXPOSE 8080
VOLUME /data
CMD ["node", "dist/index.js"]
