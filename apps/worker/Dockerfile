# Worker image. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t fulcra-worker .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# 1. Keep only the files the worker needs.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @fulcra/worker --docker

# 2. Install production dependencies only (tsx runs the TypeScript source).
FROM base AS runner
ENV NODE_ENV=production
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod
COPY --from=prune /app/out/full/ .
RUN chown -R node:node /app
USER node
WORKDIR /app/apps/worker
CMD ["node_modules/.bin/tsx", "src/index.ts"]
