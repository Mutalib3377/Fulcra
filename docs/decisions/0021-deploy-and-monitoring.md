# 0021 — Deploying, pooling, limits and monitoring

Status: accepted (L1c)

## Context

Launch needs Fulcra online on the decided stack (Render in Frankfurt, Supabase EU, Cloudflare) in a way that keeps working with more than one copy of each process, tells us when something breaks, and never leaks sellers' or customers' data to monitoring tools.

## Decision

- **Render Blueprint** (`render.yaml`): a Docker web service and a Docker background worker, Frankfurt, Starter plan. Secrets are entered in Render (`sync: false`), never committed. `docs/DEPLOY.md` is the step-by-step guide.
- **Migrations on deploy:** the worker's `preDeployCommand` runs `packages/db/src/migrate.ts` (drizzle-orm's migrator, same history table as `pnpm db:migrate`) over the direct connection. A failed migration stops the deploy. Migrations stay backward compatible so the running version keeps working while they apply.
- **Build-time values:** the landing page is static and browser code reads `NEXT_PUBLIC_*`, so `ROOT_DOMAIN` and those values are Docker build arguments of the web image.
- **Connections:** the app uses Supabase's transaction pooler (`DATABASE_URL`; prepared statements were already off, tenant settings and advisory locks are transaction-scoped). The job queue may use the session pooler (`DATABASE_URL_QUEUE`), migrations the direct connection (`DATABASE_URL_MIGRATIONS`). `DB_POOL_MAX` sets connections per process.
- **Shared rate limit:** sending website-chat messages (which costs AI money) is limited per visitor and per address through the `rate_limits` table (`consumeRateLimit`, fixed window, one atomic upsert), so all web copies share the count. Polling for replies keeps the cheap in-memory limit per process. Idle counters are pruned now and then.
- **Health:** `/api/health` (Render) only says the process answers; `/api/health?deep=1` (`systemHealth`) checks the database, late jobs (worker down or behind) and unprocessed webhooks, and answers 503 when one fails. Counts only. An external free uptime monitor watches it.
- **Sentry** (errors) on the server, the worker (each failed job, tagged with its queue) and the dashboard in the browser. **PostHog** (page views) on the landing page and dashboard. Both do nothing without keys and load in the browser only after the page is idle. Neither runs on sellers' stores.
- **Privacy:** Sentry collects no request or response bodies, headers, cookies, query strings, user info, queue payloads or local variables (`sentry-privacy.ts`, worker `monitoring.ts`): webhook and job data contain customer messages and payment details. Signed-in owners are identified by user id only. PostHog keeps marketing visitors in memory only (no cookies) and has autocapture and session recording off.

## Consequences

- Source maps are not uploaded to Sentry yet (needs an auth token in the build); stack traces show compiled code until that is added.
- Render's Starter plan and Supabase Pro are paid; see `docs/DEPLOY.md` for the rough monthly cost.
- If a Render plan does not pass environment variables to Docker builds, set `ROOT_DOMAIN` and the `NEXT_PUBLIC_*` values as build arguments by hand.
