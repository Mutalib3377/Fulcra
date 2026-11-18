# Deploying Fulcra

How to put Fulcra online: Supabase (database and login), Cloudflare (domain and photo storage), Render (web app and worker), then payments, WhatsApp, Instagram, monitoring and a final check. Follow it in order the first time. Replace `yourdomain.com` with the real domain everywhere.

Never paste keys into chat, commits or issues. Type them only into the dashboards named below.

## 0. Before you start

Accounts you need: Render, Supabase, Cloudflare (with the domain added), Paystack, Meta for Developers, Anthropic, Sentry and PostHog. Sentry and PostHog are optional; the app runs without them.

Costs at launch, roughly: Render Starter for web and worker (about $7 a month each), Supabase (the free plan pauses inactive projects, so use Pro, about $25 a month, for real sellers), Cloudflare R2 (free up to 10 GB), plus AI usage (Anthropic) and WhatsApp fees (billed to each seller's WhatsApp account when they connect through Embedded Signup).

Set the domain in code once: `DEFAULT_ROOT_DOMAIN` in `packages/config/src/app.ts`. The running app reads `ROOT_DOMAIN` from the environment.

## 1. Supabase (database and login)

1. Create a project in **Frankfurt (eu-central-1)**. Keep the database password somewhere safe.
2. **Project Settings → Database → Connection string.** You need three:
   - **Direct connection** (host `db.<ref>.supabase.co`, port 5432) → `DATABASE_URL_MIGRATIONS`. Used only for migrations.
   - **Transaction pooler** (pooler host, port **6543**) → `DATABASE_URL`. Used by the web app and worker.
   - **Session pooler** (pooler host, port **5432**) → `DATABASE_URL_QUEUE`. Used by the job queue.
3. **Project Settings → API:** copy the project URL → `SUPABASE_URL`, and the publishable key → `SUPABASE_PUBLISHABLE_KEY`.
4. **Authentication → URL Configuration:** Site URL `https://app.yourdomain.com`; add `https://app.yourdomain.com/**` to the redirect URLs.
5. **Authentication → Emails:** Supabase's built-in email sender is limited to a few emails an hour. Before sellers sign up, add your own SMTP (for example Resend's free plan) under **SMTP Settings**, with a sender like `hello@yourdomain.com`.
6. Migrations run automatically on every deploy (step 3). The restricted `fulcra_app` role for row-level security is created by the migrations.

Connections: each process opens up to `DB_POOL_MAX` (default 10). Keep web + worker (times the number of copies) under the pooler limit of your Supabase plan.

## 2. Cloudflare (domain and photos)

### Photo storage (R2)

1. **R2 → Create bucket**, e.g. `fulcra-media`, location hint Europe.
2. **Bucket → Settings → Custom Domains:** connect `media.yourdomain.com`. That address is `STORAGE_PUBLIC_URL` (`https://media.yourdomain.com`).
3. **R2 → Manage API tokens → Create token** with *Object Read & Write* on that bucket. Copy the key pair → `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
4. `STORAGE_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`, `STORAGE_REGION` = `auto`, `STORAGE_BUCKET` = the bucket name.

### DNS

Done after Render gives you its address (step 3.5). You will add:

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `@` (yourdomain.com) | `fulcra-web.onrender.com` | DNS only |
| CNAME | `app` | `fulcra-web.onrender.com` | DNS only |
| CNAME | `*` (every store) | `fulcra-web.onrender.com` | DNS only |

plus any verification records Render shows for the wildcard certificate (an `_acme-challenge` CNAME). Keep the records **DNS only** (grey cloud) so Render can issue and renew certificates.

## 3. Render (web app and worker)

1. **New → Blueprint**, pick the repository. Render reads `render.yaml`: a web service and a background worker, both in Frankfurt.
2. Fill in the values it asks for. Use the same `ENCRYPTION_KEY` on both services; generate it once on your computer:

   ```bash
   openssl rand -base64 32
   ```

   Never change it later: it decrypts sellers' saved channel tokens and shop keys.
3. `ROOT_DOMAIN` = `yourdomain.com` (no `https://`). It is also baked into the build (the landing page is static), so set it **before** the first deploy, and redeploy the web service if it ever changes. The same applies to the `NEXT_PUBLIC_*` values.
4. Deploy. The worker runs the database migrations first (`preDeployCommand`). If they fail, the deploy stops and the old version keeps running.
5. **fulcra-web → Settings → Custom Domains:** add `yourdomain.com`, `app.yourdomain.com` and `*.yourdomain.com`, then add the DNS records from step 2 in Cloudflare. Wait until Render shows the certificates as issued.

To roll back, use **Rollback** on the service in Render. Migrations only move forward, so a rollback keeps the newer database tables (they are always added in a backward-compatible way).

## 4. Payments (Paystack)

1. **Settings → API Keys & Webhooks:** webhook URL `https://app.yourdomain.com/api/webhooks/paystack`.
2. Start with the **test** secret key (`sk_test_…`) in `PAYSTACK_SECRET_KEY`. When the worker starts, it creates the Fulcra plans at Paystack.
3. Do one full test: a seller adds a bank account, a customer pays a payment link with a test card, the order turns paid and the receipt appears. Then subscribe to a plan with a test card.
4. **Going live:** switch the dashboard to Live, set the live webhook URL (same address), put the live key (`sk_live_…`) in `PAYSTACK_SECRET_KEY` on **both** services and redeploy. Test-mode subaccounts and plans do not exist in live mode: the worker recreates the plans, and **each seller must enter their bank account again** (Settings → Get paid). Ask Paystack to enable dedicated virtual accounts on the live account.

## 5. WhatsApp, Instagram and Shopify

- **WhatsApp (Meta app):** webhook URL `https://app.yourdomain.com/api/webhooks/whatsapp`, verify token = `META_WEBHOOK_VERIFY_TOKEN`, subscribe to `messages` and `message_template_status_update`. `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID` from the app. Fulcra's own number for owner alerts: `FULCRA_WHATSAPP_*` on the worker. Other sellers' numbers need Business Verification and App Review.
- **Instagram:** redirect URL `https://app.yourdomain.com/api/integrations/instagram/callback`, webhook `https://app.yourdomain.com/api/webhooks/instagram`. Advanced Access needs App Review (screen recording).
- **Shopify:** app URL and redirect `https://app.yourdomain.com/api/integrations/shopify/callback`, webhooks to `https://app.yourdomain.com/api/webhooks/shopify`.
- **AI:** `ANTHROPIC_API_KEY`. Optional `AGENT_MODEL` / `AGENT_PHOTO_MODEL` on the worker to change models without a deploy.

## 6. Monitoring

- **Sentry** (errors): create a project (EU data region), copy the DSN into `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value). Personal data is switched off (`apps/web/lib/sentry-privacy.ts`, `apps/worker/src/monitoring.ts`).
- **PostHog** (analytics): create an EU project, copy the project key into `NEXT_PUBLIC_POSTHOG_KEY`. It runs only on the landing page (no cookies) and the dashboard (owners known by user id, never email); never on sellers' stores.
- **Uptime check:** in a free uptime service (UptimeRobot or Better Stack), add an HTTP monitor for `https://app.yourdomain.com/api/health?deep=1` every 5 minutes, alerting your email or phone. It answers 503 when the database is unreachable, the worker has fallen behind (jobs waiting over 5 minutes) or webhooks are not being processed. Render's own check uses the light `/api/health`.

## 7. Final check

1. `https://yourdomain.com` shows the landing page; **Start free** opens `https://app.yourdomain.com/sign-in`.
2. Sign up with a real email: the code arrives, onboarding creates a business, the store opens at `https://<store>.yourdomain.com`.
3. Add a product with a photo: the photo loads from `media.yourdomain.com`.
4. Test chat: the assistant answers (needs `ANTHROPIC_API_KEY` and the worker running).
5. `https://app.yourdomain.com/api/health?deep=1` returns `"status":"ok"`.
6. Paystack test payment and test subscription (section 4).
7. Sentry: errors appear after a test error; PostHog: page views appear.

Then switch Paystack to live, publish the reviewed privacy policy and terms, and invite the first sellers.
