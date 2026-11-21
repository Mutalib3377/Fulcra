# 0027 — The admin area for Fulcra's staff

Status: accepted (AD1 read-only views; AD2 actions and activity log).

## Context

The owner of Fulcra needs to see every seller (sign-ups, plans, sales, what each one costs in AI and WhatsApp) and, later, act on them (extend a trial, give a plan, raise a limit, suspend). Until now that meant reading the database directly.

## Decision

- **Where:** `app.yourdomain.com/admin` (`app/(dashboard)/dashboard/admin`), outside the seller dashboard shell: an admin needs no business of their own.
- **Who:** the email addresses in `ADMIN_EMAILS` (comma-separated, set on the web service). `adminFor` turns the signed-in user into an `AdminActor`; every admin service calls `requireAdmin`, which reads the list again, so removing an email takes effect at once and a forged actor is refused. Everyone else gets the normal "not found" page (`requireAdminPage`), so the area does not reveal that it exists. No database table for admins: one setting, easy to change, nothing to leak.
- **Reading across businesses:** `adminOverview` and `adminListBusinesses` are system reads (listed in `0003`): counts and sums across businesses, plus each seller's name, store address and owner email for the list. One seller's page (`adminGetBusiness`) reads with `withTenant` for that business, like any other tenant read.
- **Money:** subscription income and seller sales in kobo; AI and WhatsApp costs are recorded in dollars (`usage_records.cost_usd`) and shown in naira at `ADMIN_USD_NGN_RATE` (default 1600). Months and days are Lagos time (`lagosPeriods`).
- **Not included:** signing in as a seller. The seller page shows what support needs without opening their dashboard.

## Consequences

- The sellers list reads up to 2,000 businesses before filtering by plan status, fine for the first years; move the status rules into SQL when that grows.
- Admin actions (AD2) will add an activity log table and a suspension marker on businesses.
