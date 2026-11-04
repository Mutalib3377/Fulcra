# Web app image. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t fulcra-web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# 1. Keep only the files the web app needs (better layer caching).
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @fulcra/web --docker

# 2. Install dependencies, then build.
FROM base AS build
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@fulcra/web

# 3. Small runtime image with the standalone server only.
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    # Must be 0.0.0.0: binding to a specific IP makes Next.js treat host rewrites as external.
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
