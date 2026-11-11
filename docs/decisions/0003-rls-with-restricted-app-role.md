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

## Update (C1): switch role per transaction instead of a second login

Implemented slightly differently from "connect as `fulcra_app`", with the same guarantee:

- `fulcra_app` is a role **without login** (migration `0000_app-role.sql`). The app keeps one connection string (the Supabase pooled URL), and `withTenant` runs `SET LOCAL ROLE fulcra_app` together with `set_config('app.business_id', …, true)` at the start of each tenant transaction. Both reset when the transaction ends, which is safe with the transaction pooler.
- So there is no second password to manage, and RLS still applies to every tenant query.
- `withSystem` is the only way to query without RLS. It is used by a few named Core services (create business, subdomain check, list my businesses, invite preview/accept; from P1: saving and processing payment webhooks, and public receipts looked up by store address + secret token; from S1: finding a store by its address, `getStoreBySubdomain`, which returns only public details — the store's products are then read with `withTenant`; from I1b: saving and processing Shopify app webhooks, which find connections by shop address; from A3a: saving and reading channel webhooks, `recordChannelWebhook` / `claimChannelWebhook`, and `findConnectionByAccount`, which finds which business a WhatsApp phone number id belongs to; from A3b: `applyTemplateStatusUpdate`, which finds the connections of a WhatsApp Business Account named in a template webhook, and `businessesWithWhatsApp` (renamed `businessesWithMessaging` in G1, now WhatsApp and Instagram), the list the automatic-messages job walks; from A4: `businessesWithAlerts` (the alerts job's list), `applyOwnerAlertStatus` (finds an alert by WhatsApp's message id) and the Fulcra-wide `platform_templates` services; from G1: `instagramTokensToRefresh`, the daily token-renewal list; everything after that runs with `withTenant`).
- A test (`packages/db/test/tenant.test.ts`) fails if any table with `business_id` lacks RLS or a `fulcra_app` policy. New business-owned tables must use `.enableRLS()` and a tenant policy (see `packages/db/src/schema/members.ts`).
