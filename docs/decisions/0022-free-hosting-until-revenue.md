# 0022 — Free hosting until sellers pay

Status: accepted (L1). Extends `docs/decisions/0021`; the paid two-service setup stays for later.

## Context

The owner has no budget before Fulcra earns money. Render has a free web service (512 MB, sleeps after 15 minutes without traffic, 750 free hours a month) but no confirmed free background worker. Supabase Free has no automatic backups and pauses idle projects. Free trials must not run up AI or WhatsApp bills.

## Decision

- **One free Render service runs both processes** (`render.yaml` → `deploy/free/Dockerfile` and `start.sh`): migrations at start-up (free services have no pre-deploy step), then the Next.js server and the worker side by side, each with a memory share (`WEB_MEMORY_MB` 256, `WORKER_MEMORY_MB` 160). If either stops, the script stops the other so Render restarts the service. Measured locally: about 370 MB together at rest. Architecture rule 1 still holds: two processes, deployed as one container.
- **Kept awake** by the free uptime monitor hitting `/api/health?deep=1` every 5 minutes, so webhooks and the every-minute jobs never wait for a cold start. About 720 of the 750 free hours a month.
- **Weekly backup** (`database-backup` job, Sundays): `pg_dump` (Postgres 17 client in the free image) of the business data (`public`, `drizzle`) and, separately and data-only, the sign-in accounts (`auth.users`, `auth.identities`) to a private R2 bucket (`BACKUP_BUCKET`), keeping 8. Two files because pg_dump drops schema options when table options are given. A restore was tested: every table's row count matched.
- **Trial guard-rails**: the 14-day trial is Growth with **100** assistant chats (`TRIAL_CONVERSATIONS`) and **without WhatsApp owner alerts** (`TRIAL_EXCLUDED_FEATURES`), which are sent from Fulcra's own number at Fulcra's cost. Staff can still switch alerts on for one business. The owner sets a monthly spending limit in the Anthropic console.
- **Upgrade path**: `render.paid.yaml` (Starter web + worker, migrations before deploy) and Supabase Pro, described in `docs/DEPLOY.md` section 8.

## Consequences

- One small free machine: heavy moments (many photo uploads at once) can run out of memory and restart the service. That is the signal to upgrade.
- Render may restart free services at any time; webhooks are retried by Paystack and Meta, and jobs live in the database, so nothing is lost.
- Backups are weekly, not daily, until Supabase Pro.
- Free plans change; `docs/DEPLOY.md` asks the owner to check limits when signing up.
