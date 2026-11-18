# Free hosting image: the web app AND the worker in one container (one free Render service).
# Build from the repo root:
#   docker build -f deploy/free/Dockerfile -t fulcra-free .
# When paying customers arrive, switch to the two-service setup (render.paid.yaml, apps/*/Dockerfile).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# 1. Keep only the files the web app and worker need.
FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.10 prune @fulcra/web @fulcra/worker --docker

# 2. Install, build the web app, and run from the same tree (simple; disk is cheap, RAM is not).
FROM base AS app
# pg_dump for the weekly database backup (works with Supabase's Postgres 15 and 17).
RUN apk add --no-cache postgresql17-client
# Baked into the build (static landing page and browser code). Render passes the service's
# environment variables as build arguments.
ARG ROOT_DOMAIN
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV ROOT_DOMAIN=$ROOT_DOMAIN \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN pnpm turbo run build --filter=@fulcra/web \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static \
 && cp -r apps/web/public apps/web/.next/standalone/apps/web/public
COPY deploy/free/start.sh /app/start.sh
ENV NODE_ENV=production \
    PORT=3000 \
    # Must be 0.0.0.0: binding to a specific IP makes Next.js treat host rewrites as external.
    HOSTNAME=0.0.0.0
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "/app/start.sh"]
