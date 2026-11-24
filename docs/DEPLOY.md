# Deploying Fulcra

How to put Fulcra online: Supabase (database and login), Cloudflare (domain and photo storage), Render (web app and worker), then payments, WhatsApp, Instagram, monitoring and a final check. Follow it in order the first time. The domain is `fulcra.online` (set in `packages/config/src/app.ts`).

**Start free, upgrade when sellers pay.** The default setup (`render.yaml`) runs everything on free plans: one free Render web service running both the web app and the worker (`deploy/free/`), Supabase Free, Cloudflare R2's free allowance. The only fixed cost is the domain (about $10 a year); AI is paid per use, with a limit you set. When paying customers arrive, switch to the paid setup (section 8).

Never paste keys into chat, commits or issues. Type them only into the dashboards named below.

## 0. Before you start

Accounts you need: Render, Supabase, Cloudflare (with the domain added), Paystack, Meta for Developers, Anthropic, Sentry and PostHog. Sentry and PostHog are optional; the app runs without them.

What it costs on the free setup:

| Item | Cost | Notes |
| --- | --- | --- |
| Render | free | One free web service (512 MB memory) runs the web app and worker. Kept awake by the uptime monitor (section 6); 750 free hours a month covers it. Render may restart free services now and then; webhooks are retried, so nothing is lost. Don't create other free Render services: the hours are shared. |
| Supabase | free | 500 MB database, 50,000 users a month. Pauses after a week without activity (the always-on worker keeps it busy). **No automatic backups**: the weekly backup (section 2) covers that. |
| Cloudflare | free | DNS, and R2 up to 10 GB of photos and backups. |
| Paystack | no monthly fee | Its fee is taken from each payment. |
| Sentry, PostHog, UptimeRobot, Resend | free plans | Plenty at launch. |
| WhatsApp | mostly free | Replies to customers inside 24 hours are free, and sellers' messages are billed to their own WhatsApp account. Owner alerts from Fulcra's number cost a little, so they are only in paid plans (not the free trial). |
| Domain | about $10 a year | Needed for `store.fulcra.online` addresses. |
| AI (Anthropic) | pay per use | Set a **monthly spending limit** in the Anthropic console (e.g. $10). Free trials are capped at 100 assistant chats each. |

Free plans change: check each provider's current limits when you sign up.

Set the domain in code once: `DEFAULT_ROOT_DOMAIN` in `packages/config/src/app.ts`. The running app reads `ROOT_DOMAIN` from the environment.

## 1. Supabase (database and login)

1. Create a project in **Frankfurt (eu-central-1)**. Keep the database password somewhere safe.
2. **Project Settings → Database → Connection string.** You need two:
   - **Transaction pooler** (pooler host, port **6543**) → `DATABASE_URL`. Used by the web app and worker.
   - **Session pooler** (pooler host, port **5432**) → `DATABASE_URL_QUEUE`. Used by the job queue.
   - The same **session pooler** string → `DATABASE_URL_MIGRATIONS` (migrations and backups). Not the "Direct connection": on the free plan it only works over IPv6, which Render cannot reach.
3. **Project Settings → API:** copy the project URL → `SUPABASE_URL`, and the publishable key → `SUPABASE_PUBLISHABLE_KEY`.
4. **Authentication → URL Configuration:** Site URL `https://app.fulcra.online`; add `https://app.fulcra.online/**` to the redirect URLs.
5. **Authentication → Emails:** Supabase's built-in email sender is limited to a few emails an hour. Before sellers sign up, add your own SMTP (for example Resend's free plan) under **SMTP Settings**, with a sender like `hello@fulcra.online`.
6. Migrations run automatically on every deploy (step 3). The restricted `fulcra_app` role for row-level security is created by the migrations.

Connections: each process opens up to `DB_POOL_MAX` (default 10). Keep web + worker (times the number of copies) under the pooler limit of your Supabase plan.

## 2. Cloudflare (domain and photos)

### Photo storage (R2)

1. **R2 → Create bucket**, e.g. `fulcra-media`, location hint Europe.
2. **Bucket → Settings → Custom Domains:** connect `media.fulcra.online`. That address is `STORAGE_PUBLIC_URL` (`https://media.fulcra.online`).
3. **R2 → Manage API tokens → Create token** with *Object Read & Write* on that bucket. Copy the key pair → `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
4. `STORAGE_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_REGION` = `auto`, `STORAGE_BUCKET` = the bucket name.

### Backups bucket (private)

Supabase's free plan keeps no backups, so the app saves one every Sunday to a separate, **private** bucket.

1. **R2 → Create bucket**, e.g. `fulcra-backups`. Do **not** connect a domain or turn on public access.
2. Give the R2 API token from above access to this bucket too (Object Read & Write).
3. Set `BACKUP_BUCKET` to its name. The last 8 weekly backups are kept; older ones are deleted.

Each backup is two files with the same date: `…-business.dump` (all business data) and `…-accounts.dump` (sign-in accounts). To restore into a new Supabase project, on your computer with Postgres 17 tools:

```bash
pg_restore --no-owner --dbname "<new direct connection string>" fulcra-<date>-business.dump
```

```bash
pg_restore --no-owner --data-only --dbname "<new direct connection string>" fulcra-<date>-accounts.dump
```

Run one backup at any time from the Render shell: `cd apps/worker && node --import tsx src/backup-now.ts`.

### DNS

Done after Render gives you its address (step 3.5). You will add:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `@` (fulcra.online) | your Render address, e.g. `fulcra.onrender.com` | DNS only |
| CNAME | `app` | the same | DNS only |
| CNAME | `*` (every store) | the same | DNS only |

plus any verification records Render shows for the wildcard certificate (an `_acme-challenge` CNAME). Keep the records **DNS only** (grey cloud) so Render can issue and renew certificates.

## 3. Render (web app and worker)

1. **New → Blueprint**, pick the repository. Render reads `render.yaml`: one free web service in Frankfurt that runs the web app and the worker together (`deploy/free/Dockerfile`, `deploy/free/start.sh`).
2. Fill in the values it asks for. Leave a value empty if you don't have it yet (Paystack, Anthropic, Meta, Instagram, Shopify, Sentry, PostHog, Fulcra's WhatsApp number); the app runs without them and you add them later under **Environment**. `ENCRYPTION_KEY` and `META_WEBHOOK_VERIFY_TOKEN` are generated by Render (`generateValue`). Never change `ENCRYPTION_KEY` later: it decrypts sellers' saved channel tokens and shop keys.
3. `ADMIN_EMAILS` = the email you sign in with (several separated by commas). It opens your admin area at `https://app.fulcra.online/admin`; for everyone else that page does not exist. `ADMIN_USD_NGN_RATE` (default 1600) converts AI and WhatsApp costs to naira there.
4. `ROOT_DOMAIN` = `fulcra.online` (no `https://`). It is also baked into the build (the landing page is static), so set it **before** the first deploy, and redeploy the web service if it ever changes. The same applies to the `NEXT_PUBLIC_*` values.
5. Deploy. The service applies database migrations when it starts; if they fail it doesn't start, and Render keeps the old version running.
6. **fulcra → Settings → Custom Domains:** add `fulcra.online`, `app.fulcra.online` and `*.fulcra.online`, then add the DNS records from step 2 in Cloudflare. Wait until Render shows the certificates as issued.

To roll back, use **Rollback** on the service in Render. Migrations only move forward, so a rollback keeps the newer database tables (they are always added in a backward-compatible way).

## 4. Payments (Paystack)

1. **Settings → API Keys & Webhooks:** webhook URL `https://app.fulcra.online/api/webhooks/paystack`.
2. Start with the **test** secret key (`sk_test_…`) in `PAYSTACK_SECRET_KEY`. When the worker starts, it creates the Fulcra plans at Paystack.
3. Do one full test: a seller adds a bank account, a customer pays a payment link with a test card, the order turns paid and the receipt appears. Then subscribe to a plan with a test card.
4. **Going live:** switch the dashboard to Live, set the live webhook URL (same address), put the live key (`sk_live_…`) in `PAYSTACK_SECRET_KEY` on **both** services and redeploy. Test-mode subaccounts and plans do not exist in live mode: the worker recreates the plans, and **each seller must enter their bank account again** (Settings → Get paid). Ask Paystack to enable dedicated virtual accounts on the live account.

## 5. WhatsApp, Instagram and Shopify

- **WhatsApp (Meta app):** webhook URL `https://app.fulcra.online/api/webhooks/whatsapp`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, subscribe to `messages` and `message_template_status_update`. `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` from the app. Fulcra's own number for owner alerts **and the owner's assistant on WhatsApp**: `FULCRA_WHATSAPP_*` on the worker, plus `FULCRA_WHATSAPP_DISPLAY_NUMBER` (the number as people dial it, e.g. `+2348012345678`) on the web service for the "chat on WhatsApp" link. Owners message that number from the alert number they saved in Settings → Alerts. Other sellers' numbers need Business Verification and App Review.
- **Instagram:** redirect URL `https://app.fulcra.online/api/integrations/instagram/callback`, webhook `https://app.fulcra.online/api/webhooks/instagram`. Advanced Access needs App Review (screen recording).
- **Shopify:** app URL and redirect `https://app.fulcra.online/api/integrations/shopify/callback`, webhooks to `https://app.fulcra.online/api/webhooks/shopify`.
- **AI:** `ANTHROPIC_API_KEY`. Optional `AGENT_MODEL` / `AGENT_PHOTO_MODEL` on the worker to change models without a deploy.

## 6. Monitoring

- **Sentry** (errors): create a project (EU data region), copy the DSN into `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value). Personal data is switched off (`apps/web/lib/sentry-privacy.ts`, `apps/worker/src/monitoring.ts`).
- **PostHog** (analytics): create an EU project, copy the project key into `NEXT_PUBLIC_POSTHOG_KEY`. It runs only on the landing page (no cookies) and the dashboard (owners known by user id, never email); never on sellers' stores.
- **Uptime check (also keeps the free service awake):** in a free uptime service (UptimeRobot or Better Stack), add an HTTP monitor for `https://app.fulcra.online/api/health?deep=1` **every 5 minutes**, alerting your email or phone. The visits stop Render's free service from going to sleep, so webhooks arrive instantly and the every-minute jobs keep running. It answers 503 when the database is unreachable, the worker has fallen behind (jobs waiting over 5 minutes) or webhooks are not being processed. Render's own check uses the light `/api/health`.

## 7. Final check

1. `https://fulcra.online` shows the landing page; **Start free** opens `https://app.fulcra.online/sign-in`.
2. Sign up with a real email: the code arrives, onboarding creates a business, the store opens at `https://<store>.fulcra.online`.
3. Add a product with a photo: the photo loads from `media.fulcra.online`.
4. Test chat: the assistant answers (needs `ANTHROPIC_API_KEY` and the worker running).
5. `https://app.fulcra.online/api/health?deep=1` returns `"status":"ok"`.
6. Paystack test payment and test subscription (section 4).
7. Sentry: errors appear after a test error; PostHog: page views appear.

Then switch Paystack to live, publish the reviewed privacy policy and terms, and invite the first sellers.

## 8. Upgrading when sellers pay

Signs it's time: the service restarts because it runs out of memory (Render's events show it), pages feel slow at busy times, or the database nears 500 MB.

1. **Render:** rename `render.paid.yaml` to `render.yaml` (replacing the free one), push, and sync the Blueprint in Render. That gives a Starter web service and a separate Starter worker (about $7 a month each). Copy `ENCRYPTION_KEY` from the free service (Environment) into both new services: it must stay the same. Migrations then run before each worker deploy. Point the custom domains at the new web service and delete the free one.
2. **Supabase:** upgrade to Pro (about $25 a month) for daily backups and no pausing. The weekly backup can stay on as an extra copy (it needs `pg_dump`, which only the free image has; leave `BACKUP_BUCKET` empty on the paid worker otherwise).
3. Remove the 5-minute keep-awake need (the monitor can stay as an uptime check).
