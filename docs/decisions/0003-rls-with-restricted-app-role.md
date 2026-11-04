# 0003 — Row-level security with a restricted app role

Status: accepted (implemented in C1)

## Context

Tenant isolation has two guards: tenant-scoped query helpers in `packages/db`, and Postgres RLS. RLS does nothing when the app connects as the database owner or `postgres`, because those roles bypass it.

## Decision

- Migrations run as the owner role. The web app and worker connect as a separate role (`fulcra_app`) **without** `BYPASSRLS`.
- Every tenant query runs inside a transaction that first calls `set_config('app.business_id', <id>, true)`. The tenant helpers do this; code cannot query business tables without a `businessId`.
- Each business-owned table has a policy: `business_id = current_setting('app.business_id', true)::uuid`. When the setting is missing, no rows are visible.
- Work that must look across businesses (finding which business a webhook belongs to, scheduled jobs) uses a small set of named "system" functions in `packages/db` with a separate privileged connection. These are kept few and reviewed carefully.
- Supabase's `anon` and `authenticated` roles get no access to our tables, so the public Supabase API cannot read them.

## Consequences

- Each request uses a short transaction. This works with Supabase's transaction pooler.
- Isolation tests in C1 must run as `fulcra_app`, not as the owner.
