# CLAUDE.md — Fulcra project guide

Read this file fully before doing any work. Then read `docs/PRODUCT_PLAN.md` (what we are building and why) and `docs/BUILD_PLAN.md` (what to build, in order).

## What we are building

An **AI sales agent** for small product sellers in Nigeria (fashion, beauty, food, gadgets). It works like a full-time virtual assistant: it answers customers, sells, takes orders, confirms payments and reports to the owner — across **WhatsApp, Instagram DMs and the seller's website**.

Everything is built around a shared "business brain" (the Core): brand kit, products, customers, orders, payments. The agent reads from and writes to the Core.

**First module (the launch): AI Sales Agent**, which includes:
- the agent on WhatsApp, Instagram DMs and a website chat widget;
- payments that confirm themselves, with receipts;
- a simple storefront at `brandname.yourdomain.com` for sellers without a website;
- website connection for sellers who already have one (catalog import from Shopify, WooCommerce, CSV or a link; chat widget; WhatsApp buttons);
- the owner dashboard (unified inbox, catalog, orders, customers, payments, billing).

**Later modules** (paid add-ons): full Storefront upgrades, Content Studio, Strategist, Debt Recovery.

Every module must be switchable on/off per business (see "Entitlements").

The product is called **Fulcra**. The domain is not decided yet: use `yourdomain.com` as a placeholder. Both live in one config file (`packages/config/src/app.ts`) so they are easy to change.

## Current status

> Update this section whenever a phase is finished.

- Current milestone: **Milestone 4 (Instagram, website widget, billing → launch)**, built while the owner runs the Milestone 3 gate (design partners on WhatsApp for a week) and confirms the owner confirms the Milestone 2 gate (one design partner on our store, one importing from their own website; at least 3 with real catalogs) and the Milestone 1 gate (core + payments end to end with one real seller's product data)
- Current phase: **L1 — Launch readiness**: parts L1a (setup checklist and dashboard home), L1b (design system, landing page, privacy and terms drafts) and L1c (Render Blueprint, deploy guide, pooled connections, shared rate limit, deep health check, Sentry, PostHog) done. Hosting starts free (one free Render service, Supabase Free, weekly backups; `docs/decisions/0022`). O1 (the owner's assistant: "Ask Fulcra" in the dashboard and on WhatsApp through Fulcra's number) done. F1 (fake alert protection: payment claims checked against the money, owner alert, Payments → Payment checks, Ask Fulcra tool) done. K1 (store checkout: add to cart, cart, checkout and Paystack on the store) done. T1 (store themes): T1a (setting, six themes on home, cards and header, picker and preview) done; T1b (product, cart and checkout pages) next. The rest of L1 is the owner's: deploying with `docs/DEPLOY.md`, Paystack live mode, lawyer-checked privacy and terms; then the launch gate. The Milestone 3 gate (design partners on WhatsApp for a week) is the owner's and runs in parallel
- Completed phases: Week 0 setup, C1 — Accounts and businesses, C2 — Brand kit and catalog (the "20 products in 30 minutes" check with a real seller's products is the owner's to confirm), C3 — Customers, delivery and orders, P1 — Payment links and receipts, P2 — Dedicated virtual accounts, S1 — Simple storefront, A1 — Conversation foundation, A2 — The agent brain (tested with a fake Claude API; a real run and the reply-model measurement need `ANTHROPIC_API_KEY`), A3 — WhatsApp adapter (tested with a fake Meta API; the owner tested messages with Meta's test number; the "Connect WhatsApp" button needs the owner's Embedded Signup configuration, and other sellers' numbers need Business Verification and App Review), W1 — Website chat widget (tested in a browser on a pretend seller site with a fake Claude; a real WordPress install is the owner's), G1 — Instagram adapter (tested with a fake Instagram API; a real test needs the owner's Instagram app keys and a professional account; App Review needs the owner's screen recording), A4 — Owner alerts and daily briefing (tested with a fake Meta API; real alerts need `FULCRA_WHATSAPP_*`), I2 — WhatsApp buttons for existing websites, B1 — Entitlements and billing (Paystack subscriptions tested with a fake Paystack; real test-mode subscriptions need the owner's Paystack test key), I1 — Catalog import (CSV, Shopify, WooCommerce, website link; tested with fake shops and a fake Claude API — a real Shopify test needs the owner's Shopify app keys, and real website reading needs `ANTHROPIC_API_KEY`) (P1 and P2 tested end to end with a fake Paystack; real test-mode payments need the owner's Paystack test key, and dedicated accounts need Paystack to enable them)
- Repository: `Mutalib3377/Fulcra` (back on the original repo; `officialbobo9-netizen/Fulcra-` is no longer used)

## Tech stack (decided — do not change without asking)

| Area | Choice |
| --- | --- |
| Language | TypeScript everywhere (strict mode) |
| Monorepo | pnpm workspaces + Turborepo |
| Web app | Next.js (App Router) + Tailwind CSS + shadcn/ui |
| Background worker | Node.js process (`apps/worker`) |
| Database | PostgreSQL on Supabase (EU region, e.g. Frankfurt) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Validation | Zod (every input from users, webhooks, AI tools) |
| Job queue | pg-boss (on the same Postgres, no Redis) |
| Auth | Supabase Auth |
| File storage | Cloudflare R2 (S3-compatible) |
| Payments | Paystack (payment links, dedicated virtual accounts, webhooks). Money settles to each seller through a Paystack **subaccount**; we never hold sellers' funds (see `docs/decisions/0001`) |
| WhatsApp | WhatsApp Business Platform (Cloud API) |
| Instagram | Instagram API with Instagram Login (messaging) |
| Website chat | Our own embeddable widget (`packages/widget`), served as one script |
| Catalog import | Shopify Admin API, WooCommerce REST API, CSV, AI extraction from a URL |
| AI | Claude API (Anthropic SDK), tool use for the agent |
| Client data fetching | TanStack Query |
| Forms | react-hook-form + Zod |
| Hosting | Render (web service + background worker), EU region |
| DNS / CDN | Cloudflare (wildcard subdomain `*.yourdomain.com`) |
| Errors / analytics | Sentry + PostHog |

During development everything runs locally (Postgres via Supabase CLI or Docker, worker locally, Cloudflare Tunnel for webhooks). Do not add paid services.

## Repo structure

```
apps/
  web/                 Next.js app
    app/
      (marketing)/     landing page on yourdomain.com
      (dashboard)/     owner dashboard on app.yourdomain.com
      (store)/         storefronts on <subdomain>.yourdomain.com
      api/
        webhooks/      paystack/, whatsapp/, instagram/, shopify/, woocommerce/
        widget/        endpoints used by the website chat widget
    proxy.ts           reads the host, routes to marketing / dashboard / store (Next.js 16 name for middleware)
  worker/              background jobs: agent replies, imports, alerts, briefings
packages/
  core/                ALL business logic (services). See rules below.
    src/
      businesses/  members/  brand-kit/  catalog/  customers/
      orders/  payments/  delivery/  events/  entitlements/  usage/
  agent/               the AI agent: prompts, tools, conversation logic (channel-agnostic)
  channels/            one adapter per channel: whatsapp/, instagram/, web-widget/
  integrations/        catalog sources: shopify/, woocommerce/, csv/, url-extract/
  modules/             later modules: content-studio/, strategist/, debt-recovery/
  widget/              embeddable website chat widget (builds to one small JS file)
  db/                  Drizzle schema, migrations, db client, tenant-scoped helpers
  ui/                  shared UI components (shadcn-based)
  config/              shared tsconfig, eslint, tailwind preset, app constants
docs/
  PRODUCT_PLAN.md
  BUILD_PLAN.md
  decisions/           short notes for important decisions (ADR style)
```

## Architecture rules (non-negotiable)

1. **Modular monolith.** One repo, one database, two deployable processes (`web` and `worker`). No microservices.
2. **All business logic lives in `packages/core`.** Pages, API routes, webhooks, integrations and AI agent tools only call service functions such as `createOrder`, `confirmPayment`, `adjustStock`. Never put business logic in a React component or route handler.
3. **One agent, many channels.** The agent in `packages/agent` never knows which platform it is on. Each channel adapter in `packages/channels` converts platform messages to our standard `InboundMessage` and converts the agent's `OutboundMessage` back to the platform format. Adding a channel = adding an adapter, nothing else.
4. **Modules and packages do not import sideways.** `agent`, `channels`, `integrations` and `modules/*` import from `core`, `db` and `config` only (the agent may use the `channels` interface types). Packages communicate through Core data and the `events` table.
5. **Multi-tenancy.** Every business-owned table has `business_id`. Every query is scoped by `business_id` through tenant-scoped helpers in `packages/db`. Postgres row-level security (RLS) is enabled as a second guard: every tenant query runs as a restricted role without `BYPASSRLS` with the current business set on the transaction (`withTenant`, see `docs/decisions/0003`). A business must never see another business's data.
6. **Entitlements.** Before a module or channel action runs, check `canUse(businessId, featureKey)` (a stub that allows everything exists from C1; real plans arrive in B1). Usage-based features (agent conversations, AI calls) also call `recordUsage(...)` and respect plan limits.
7. **Events.** Important actions write to `events` (e.g. `order.created`, `payment.confirmed`, `stock.low`, `conversation.handoff`). Other parts react through jobs.
8. **Slow work goes to the queue.** Every webhook handler: verify signature → save raw event to `webhook_events` → enqueue job → return 200 quickly. The worker does the processing.
9. **Webhooks are idempotent.** Each provider event id/reference is unique in the database. Duplicates are ignored. A payment must never be counted twice.
10. **The AI agent never touches the database directly.** Agent tools call Core services with Zod-validated input. Prices, stock, delivery fees and payment status always come from the database, never from the model. If the agent is unsure, it hands off to a human.
11. **Secrets** (channel access tokens per business, API keys) are stored encrypted or in environment variables. Never commit secrets. Keep `.env.example` updated.
12. **Track cost.** Log the cost of every AI call and WhatsApp conversation against the business that caused it (`usage_records`).
13. **Stay portable.** Standard Postgres and standard Node. Both apps build into Docker images.

## Product rules (affect UX and code)

- Users are Nigerian small business owners, mostly on **mobile phones** with **unstable internet**. Design mobile-first. Keep pages light and fast.
- Money is in **Naira**. Store amounts as **integers in kobo** (₦1 = 100 kobo). Display with `Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })`.
- Phone numbers are stored in E.164 (`+234...`). Accept local formats (`080...`) and normalise.
- Storefront pages must load fast on cheap Android phones: server-render, cache per business, optimise images, minimal client JS.
- The website widget must be tiny, load asynchronously and never slow down or break the seller's site.
- Plain, friendly language in the UI. No jargon.
- Meta rules: replies are free-form only within 24 hours of the customer's last message. Outside that window, WhatsApp needs approved templates and Instagram cannot message. Design all follow-ups around this.

## Coding conventions

- TypeScript strict. No `any` unless unavoidable and commented.
- Zod schemas for every external input; infer types from schemas.
- Server Components by default; Client Components only where interaction is needed.
- Server Actions / route handlers call `packages/core` services; they do not query the DB directly.
- File and folder names: `kebab-case`. React components: `PascalCase`. Functions: `camelCase`.
- Unit tests (Vitest) for every Core service, especially orders, stock, payments, entitlements and tenant isolation.
- Agent behaviour tests: recorded conversation scenarios (price question, screenshot, out of stock, full order, handoff).
- Every schema change gets a new Drizzle migration. Never edit an old migration.
- Handle loading, empty and error states in every screen.

## Git rules

- One branch and one pull request per task: `feat/c1-auth`, `fix/orders-stock-count`.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- **Never mention Claude, Claude Code or any AI tool in commits, PR titles or PR descriptions. No `Co-Authored-By` trailers or any AI attribution.** Messages describe the change only.

## How to work in this repo

1. Work on **one phase at a time**, in the order of `docs/BUILD_PLAN.md`. Do not build later phases early.
2. Before starting a phase, read its section and propose a short plan (files, schema changes, steps). Wait for approval if the plan changes the schema or these rules.
3. Build task by task. After each task: run type-check, lint and tests.
4. Tick the task in `BUILD_PLAN.md` (`- [x]`) when it is done and working.
5. When a phase's "Done when" check passes, update "Current status" at the top of this file.
6. Ask before: adding a dependency, adding a paid service, changing a decided stack item, or changing these rules.
7. If something in the plan seems wrong, say so and suggest a better option instead of silently changing it.

## Commands

Run from the repo root. First time: `pnpm install`, `cp .env.example .env`, `pnpm db:up`, `pnpm db:migrate`. Needs Docker (for the Supabase CLI).

- `pnpm dev` — run web (http://localhost:3000) and worker locally, with hot reload
  - Marketing: `localhost:3000` · Dashboard: `app.localhost:3000` · Store: `<name>.localhost:3000`
- `pnpm build` — build everything
- `pnpm lint` / `pnpm typecheck` / `pnpm test` — must pass before a task is ticked
- `pnpm check` — everything CI runs (format check, lint, type-check, tests, build). Needs the local database up (`pnpm db:up`). A git pre-push hook (`.githooks/pre-push`, installed by `pnpm install`) runs it before every push; GitHub Actions CI is paused while the GitHub account has a billing lock, so this hook is the gate for now. `git push --no-verify` skips it — emergencies only
- `pnpm format` / `pnpm format:check` — Prettier (Markdown files are not formatted)
- `pnpm db:up` / `pnpm db:down` — start/stop local Supabase (Postgres on 54322, Auth and Storage on 54321, test inbox for sign-in codes on http://127.0.0.1:54324). `db:up` also creates the `fulcra-media` storage bucket.
- `pnpm db:status` — local Supabase URLs and keys · `pnpm db:reset` — wipe the local database and re-apply migrations
- `pnpm db:generate` — create a new migration from schema changes in `packages/db/src/schema`
- `pnpm db:migrate` — apply migrations
- `pnpm --filter @fulcra/<name> <script>` — run a script in one package (e.g. `pnpm --filter @fulcra/core test`)
- `docker build -f apps/web/Dockerfile .` / `docker build -f apps/worker/Dockerfile .` — production images

Notes:

- Workspace packages export TypeScript source (no build step). Next.js compiles them via `transpilePackages`; the worker runs with `tsx`.
- All apps read one `.env` at the repo root. In production, real environment variables are used.
- The web container must listen on `HOSTNAME=0.0.0.0` (set in the Dockerfile); binding to a specific IP breaks host-based rewrites.
- Database tests use a separate database (`DATABASE_URL_TEST`, name must contain `test`), created and migrated automatically.
- Server Actions must not call `redirect()`: Next.js renders the target without going through `proxy.ts`, so `/` would show the marketing page. Return `{ redirectTo }` and navigate on the client with `goTo()` (`apps/web/lib/navigation.ts`), or use `ActionButton`.
- Tenant data: Core services use `withTenant(businessId, …)`. `withSystem` (no RLS) is only for the few cross-business services listed in `docs/decisions/0003`.
- Client Components import Core rules from `@fulcra/core/rules` (browser-safe), never from `@fulcra/core`.
- Images: upload through `POST /api/uploads` (Server Actions cap bodies at 1 MB). Store the returned `StoredImage` and build URLs on the server with `imageUrl()` / `withUrls()` (`apps/web/lib/images.ts`); render with a plain `<img>` (sizes are pre-made).
- Stock only changes through Core (`applyStockChange` inside a transaction, `adjustStock` from the UI). Never update `product_variants.stock` directly (`docs/decisions/0004`).
- Orders: create with `createOrderInTx` / `createOrder` (prices and stock from the database), move with `updateOrderStatus`, `markOrderPaid`, `cancelOrder`. Important actions write `events` in the same transaction via `recordEvent` (`docs/decisions/0005`).
- Storefront: pages live in `app/(store)/store/[subdomain]/(shop)` and read through the cached loaders in `apps/web/lib/store.ts` (Core: `getStoreBySubdomain`, `getStoreHome`, `listStoreProducts`, `getStoreProduct`). Server Actions that change what a store shows (products, brand kit, orders) call `refreshStore(actor)`; the cache also expires after 60 seconds for stock changed by the worker. Store pages use plain `<a>` links (no prefetching on slow data) and work without JavaScript. Link previews use JPEG copies from `/api/share-image`. Store look (redesign): the brand kit becomes CSS variables in the store layout (`--store-primary`, tints mixed in `globals.css` `.store`, heading style and corner radius from `brandFontOptions`); the hero shows a collage of featured photos; `StoreInfo.trust` (secure payments when payouts are set, delivery area names) feeds the trust row, so stores only promise what is set up; cards show `fewLeft`; product pages have a fixed order bar on phones, `ShareButton` (share sheet, else WhatsApp) and related products; the footer links to Fulcra with `?ref=store` UTM tags (growth loop). Bump `CACHE_VERSION` in `lib/store.ts` when cached store data changes shape. Store themes (T1): `brand_kits.store_theme`; `lib/store-themes.ts` (hero, card, phone columns, radius per theme) and `lib/store-theme-server.ts` (`storeThemeFor`, which also honours the private preview cookie from `/preview-theme/<theme>`); colours are `--store-*` variables per `data-store-theme` in `globals.css`: store components must use them, never fixed colours (Bold is dark). Hero layouts in `_components/store-hero.tsx`, card shapes in `product-grid.tsx`, picker `settings/brand/theme-picker.tsx`. See `docs/decisions/0026`.
- Imports: CSV, shop and website imports become `catalog_imports` with one `catalog_import_items` row per product. CSV and website imports wait for the seller's review; `confirmImport` queues the `catalog-import` job, and `processCatalogImport` in the worker saves products one by one with `saveImportedProductInTx` (same rules as the product form; matched by `source` + `external_id`, stock changes recorded as `import`). Anything fetched from a seller's link goes through `safeFetch` (public addresses only; `FETCH_ALLOW_PRIVATE_HOSTS=true` for local testing). Shop connections (`catalog_sources`, one per kind per business) keep their keys encrypted with `encryptSecret` (`ENCRYPTION_KEY`); shop imports skip review: the worker reads the shop with `@fulcra/integrations` (`fetchShopCatalog`), then `saveFetchedProducts` and the usual saving. Shopify connects through our app (OAuth in `app/api/integrations/shopify`), WooCommerce with read-only REST keys. Website imports read the page and its product pages (`extractWebsiteCatalog`): schema.org JSON-LD is used directly, other pages are read by Claude (`URL_EXTRACT_MODEL`, structured output), then wait for review. See `docs/decisions/0008`.
- WhatsApp buttons for sellers' own websites: Settings → WhatsApp buttons (`/settings/whatsapp-buttons`). The link and code builders (`whatsAppLink`, `whatsAppButtonHtml`, `whatsAppFloatingHtml`, `whatsAppProductMessage`) are browser-safe in `@fulcra/core/rules`; generated code is plain HTML with inline styles and every value escaped.
- Conversations: every channel turns platform messages into Core's `InboundMessage` / `OutboundMessage` (`packages/core/src/conversations/message-types.ts`, re-exported by `@fulcra/channels` with the `ChannelAdapter` interface). Incoming: the `inbound-message` job → `receiveInboundMessage` (finds/creates customer and open conversation, saves once by `external_id`, routes to the assistant or marks "needs attention"). Outgoing: `sendHumanReply` (takes over the chat, checks `replyWindow` for the 24-hour rule) → `send-message` job → `claimOutboundMessage` → channel adapter → `markMessageSent`. Test chats use a `mode: 'test'` connection that behaves like WhatsApp and sends nothing. The inbox polls JSON routes in `app/api/inbox` with TanStack Query. See `docs/decisions/0010`.
- WhatsApp: one app-level webhook `app/api/webhooks/whatsapp` (verify with the adapter → `recordChannelWebhook` → `channel-webhook` job). The worker parses with `adapterFor(channel).parseWebhook`, finds the business with `findConnectionByAccount` (phone number id), downloads photos (`downloadMedia` → `storeImage`), then queues the usual `inbound-message`; delivery updates go to `message-status` jobs (`recordWhatsAppUsage` for charged messages, once per message id; `applyMessageStatus` moves ticks forward and retries until our send is saved). The adapter (`packages/channels/src/whatsapp`) calls the Graph API with plain fetch (`WHATSAPP_GRAPH_VERSION`, `WHATSAPP_GRAPH_URL` for fakes). Settings → WhatsApp (`/settings/whatsapp`) checks details with `lookupWhatsAppNumber` before `saveWhatsAppConnection` (owner, token encrypted). A send refused for the token marks the connection "Needs attention" (`markConnectionError`). See `docs/decisions/0013`. Templates (`message_templates`, starter set in `STARTER_TEMPLATES`) are added on connect and sent to Meta by the `submit-templates` job; Meta's decisions arrive on the same webhook (`applyTemplateStatusUpdate`). The `customer-notifications` job runs every minute: for each business with WhatsApp or Instagram (`businessesWithMessaging`) it finds order events not yet messaged (`pendingCustomerNotifications`) and sends them once (`sendCustomerNotification`: free-form while the chat is open, the approved template otherwise; waits if not approved). Outbound messages carry `payload.template` when they are templates. The inbox offers `inboxTemplateOptions` / `sendInboxTemplate` when the window has closed. "Connect WhatsApp" (Embedded Signup) is `connect-button.tsx` + `completeEmbeddedSignupAction` (`exchangeEmbeddedSignupCode`, `registerWhatsAppNumber`). See `docs/decisions/0014`.
- Owner alerts (A4): Settings → Alerts (`getOwnerAlertSettings` / `saveOwnerAlertSettings`, `owner_notification_settings`). The `owner-alerts` job runs every minute: for each business with an alert number (`businessesWithAlerts`) it turns events into `owner_alerts` once each (`createPendingAlerts`: paid orders, low stock, payments to check, chats the assistant passed on), adds the briefing when due (`createBriefingIfDue`, once per local day), and sends pending ones from Fulcra's own number (`platformWhatsApp()` from `FULCRA_WHATSAPP_*`) with approved `platform_templates` (`claimOwnerAlert` → adapter → `markOwnerAlertSent`). Without Fulcra's number, alerts are kept as "not sent". Delivery updates for Fulcra's number go to `applyOwnerAlertStatus` (ticks, cost as `owner_alert.<category>`). Platform templates are added at worker start and sent by `submit-platform-templates`. Automatic customer messages respect `customerMessagesEnabled`. The assistant offers only the owner's `paymentOptions` (link / transfer). See `docs/decisions/0015`.
- Instagram (G1): "Connect Instagram" is `app/api/integrations/instagram/{start,callback}` (signed state `createSignedState` + nonce cookie; `exchangeInstagramCode` gives a 60-day token; `subscribeInstagramApp`; `saveInstagramConnection` stores it encrypted with `expires_at`). The `refresh-channel-tokens` job renews tokens daily when 15 days are left (`instagramTokensToRefresh`, `connectionToken`, `refreshInstagramToken`, `saveRenewedToken`). Webhook `app/api/webhooks/instagram` (Instagram app secret) feeds the same `channel-webhook` job; the adapter (`packages/channels/src/instagram`, `INSTAGRAM_TEST_BASE_URL` for fakes, non-production only) gives photos as `media.url` (downloaded and stored by the worker) and names via `lookupProfile`. No templates on Instagram: nothing is sent after 24 hours. See `docs/decisions/0016`.
- Website chat (W1): Settings → Website chat (`getWebChat` / `setWebChatEnabled`: a `web` connection whose `external_account_id` is the public key `wk_…`). The widget (`packages/widget`, plain TypeScript in a shadow DOM, built by esbuild into `apps/web/public/widget.js` — the web build depends on it; `pnpm dev` watches it) calls `app/api/widget/{config,messages}` (CORS with `isAllowedWidgetOrigin`, in-memory limits in `apps/web/lib/rate-limit.ts`, config cached a minute). Core: `getWidgetConfig`, `sendWidgetMessage` (queues the usual `inbound-message`, external id `web:<visitor>:<message>`), `getWidgetMessages` (polling with a millisecond cursor; marks replies read). Visitors are anonymous (`customer_identities` channel `web`, id kept in the browser); the assistant's `saveCustomerDetails` saves name and phone and merges into a known customer (`mergeCustomerIntoInTx`). The web adapter only gives replies an id. WordPress plugin: `app/api/widget/wordpress-plugin` (zip written by `apps/web/lib/zip.ts`). The store loads the widget and shows "Chat to buy" (`data-fulcra-open`) when the chat is on (`StoreInfo.webChatKey`). See `docs/decisions/0017`.
- Plans and limits (B1): what each plan includes is in `PLANS` (`packages/core/src/billing/rules.ts`, browser-safe: prices, conversations a month, channels, features); `subscriptions` holds each business's plan and dates (every business starts a 14-day trial of Growth, `createBusiness`, capped at `TRIAL_CONVERSATIONS` = 100 chats and without `TRIAL_EXCLUDED_FEATURES` such as owner alerts, which cost Fulcra money); `effectiveStatus` decides from dates (trial ended, paid period, 7-day grace). `canUse` / `featureAccess` / `requireFeatureInTx` (`billing/entitlements.ts`) combine plan, trial, `entitlements` switches and Starter's one-channel rule, with a plain "upgrade" message. Without a plan, sales and data keep working (`INACTIVE_FEATURES`); the assistant, alerts and automatic customer messages pause. The assistant calls `claimAgentConversation` before each reply: a chat counts once a month (`usage_records` kind `agent_conversation`, reference `conv:<id>:<YYYY-MM>`), over the limit the chat goes to the team; crossing 80% and 100% writes `usage.limit` (banner `BillingBanner`, WhatsApp alert `usage_limit`). Fulcra staff change one business with `setBusinessEntitlement` (e.g. `agent.conversations`). See `docs/decisions/0018`.
- Paying for plans (B1b): `billing/subscriptions.ts`. The `sync-billing-plans` job (worker start, with a Paystack key) fills `plans` from `PLANS` and creates each plan at Paystack (`syncBillingPlans`). `choosePlan` starts a checkout (metadata `kind: 'fulcra_subscription'`, no subaccount: the money is ours) or, for a smaller plan, disables the current subscription and schedules the new one on the saved card from the end of the period (`pendingPlanCode`); `cancelPlan` stops renewal. Paystack's subscription webhooks arrive on the usual Paystack webhook: `processPaystackWebhook` sends them to `processSubscriptionWebhook` (`isSubscriptionWebhook`), which verifies charges, records `subscription_payments` once per reference and moves the period on; webhooks that arrive before the payment they belong to throw `SubscriptionNotLinkedYet` so the job retries. See `docs/decisions/0019`.
- Dashboard home (L1a): `getHomeSummary` (`businesses/home.ts`) gives today's paid sales (business's time zone), chats waiting and the "Get set up" steps (`setupStepKeys`), each worked out from data (store or website address, brand kit saved, a product, a delivery zone, payout account, a live connected channel, an assistant reply in the test chat). Step wording and links are in `apps/web/lib/setup.ts`; "Hide" is a per-business cookie (`setupHiddenCookie`, value `1`). Riders see sales only.
- Design system: tokens in `packages/ui/src/styles/globals.css` (semantic colours with dark values, type scale, radii, shadows, easing); components in `@fulcra/ui` (`Button` variants incl. `tinted`, `Card`, fields share `fieldClasses`, `Badge`, `Switch`, `SegmentedControl`, `Sheet`, `ListGroup` / `ListRow` / `ListRowContent` for grouped lists, states). Dashboard pages start with `PageHeader` (title, `back`, `actions`) from `apps/web/components/page-header.tsx`; long forms put their main button in `StickyActions`; loading screens are skeletons. Use token names, never raw colours. Inter is self-hosted (`apps/web/public/fonts`, plus a ₦-only file). The dashboard's look comes from Settings → Appearance (Automatic / Light / Dark, cookie `fulcra-theme`, `lib/theme.ts`; the dashboard layout reads it so the first paint is right) and the header's sun/moon `ThemeToggle` (`components/theme-controls.tsx`); it sets `data-color-scheme` to `auto` (follows the phone), `light` or `dark`. The dark values live twice in the UI tokens (always-dark and automatic): change both. Stores stay light. App motion is CSS only; GSAP/three.js only on the marketing site. Reference page: `/design` (`SHOW_DESIGN_PAGE=true` in production). See `docs/decisions/0020`.
- Marketing site: `app/(marketing)` (landing, `/privacy`, `/terms`, drafts until a lawyer checks them). Static, so `ROOT_DOMAIN` must be set at build time. The hero background is three.js + a GLSL shader (`_components/hero-scene.tsx`, `hero-shader.ts`), loaded after the page shows and skipped on low-memory phones, data saver, reduced motion or no WebGL; it stops drawing off screen. The sale story and section fade-ins use GSAP ScrollTrigger (lazy); all content is visible without JavaScript. Pricing reads `PLANS` on the server.
- Deploy and monitoring (L1c): `render.yaml` (web + worker, Frankfurt), guide in `docs/DEPLOY.md`. The worker's `preDeployCommand` runs `packages/db/src/migrate.ts`. Connections: `DATABASE_URL` (transaction pooler), optional `DATABASE_URL_QUEUE` (pg-boss, `getQueueDatabaseUrl`), `DATABASE_URL_MIGRATIONS` (direct), `DB_POOL_MAX`. `ROOT_DOMAIN` and `NEXT_PUBLIC_*` are web build arguments. Sending website-chat messages is limited with Core's `consumeRateLimit` (`rate_limits`, shared by all instances); polling keeps the in-memory `allow`. `/api/health?deep=1` → `systemHealth` (database, late jobs, unprocessed webhooks; 503 when failing). Sentry: `apps/web/instrumentation.ts`, worker `monitoring.ts` (`reported` wraps every job handler); browser Sentry (dashboard) and PostHog (landing and dashboard, never stores) load lazily in `components/monitoring.tsx`. No personal data to Sentry (`lib/sentry-privacy.ts`). See `docs/decisions/0021`.
- Free hosting (until sellers pay): `render.yaml` is one free Render web service running web + worker in one container (`deploy/free/Dockerfile`, `deploy/free/start.sh`: migrations, then both processes; either stopping stops both). A free uptime monitor on `/api/health?deep=1` every 5 minutes keeps it awake. The `database-backup` job (worker `jobs/backup.ts`, Sundays) dumps business data and sign-in accounts with `pg_dump` to a private bucket (`BACKUP_BUCKET`, keeps 8; `pnpm --filter @fulcra/worker backup` runs one). The paid setup is `render.paid.yaml`. See `docs/decisions/0022`.
- Owner's assistant (O1): `owner_chats` / `owner_chat_messages`; Core `owner-chat/` (`sendOwnerDashboardMessage`, `getOwnerDashboardChat`, `claimOwnerTurn`, `proposeOwnerAction`, `saveOwnerReply`, read tools `ownerSalesSummary` / `ownerBestSellers` / `ownerOrders` / `ownerFindOrder` / `ownerFindProducts`, changes in `actions.ts`). The AI only proposes; a YES/NO (`isConfirmation` / `isRefusal`) is handled in Core without the AI and runs the saved change once through the usual services (acting as the owner member). `runOwnerTurn` in `packages/agent/src/owner.ts` (job `owner-message`). Dashboard page `/ask` (polls `app/api/owner-chat`). WhatsApp: messages to Fulcra's number go to `handleOwnerWhatsAppMessage` (worker `jobs/owner-whatsapp.ts`) → `receiveOwnerWhatsAppMessage` (owner found by the alert number; "switch to <name>" for several businesses); replies go out through the `owner-whatsapp-send` job (`claimOwnerOutbound` → adapter → `markOwnerOutboundSent`). `FULCRA_WHATSAPP_DISPLAY_NUMBER` shows the WhatsApp link. Feature `owner_assistant`; 300 owner messages a month, 50 in the trial. See `docs/decisions/0023`.
- Fake alert protection (F1): `payment_claims` (Core `payments/claims.ts`, rules in `payments/claim-rules.ts`, browser-safe). A payment screenshot's details (`payment` on the photo description) become a claim in `savePhotoDescription` (`recordScreenshotClaimInTx`); "I've paid" becomes one through `checkPaymentStatus` with `customerSaysPaid` (`recordSaidPaidClaimInTx`). A claim never marks anything paid. The `payment-claims` job (every minute, `businessesWithOpenClaims` → `sweepPaymentClaims`) confirms claims when the money arrives and, after `CLAIM_WAIT_MINUTES` (20) with nothing, marks them `not_received` with a `payment.claim_unverified` event (`payment.claim_cleared` if money comes later). Red flags from `claimFlags`. Owners see claims as "payment checks": the `payment_claim` WhatsApp alert (under "Payment to check"), `/payments?show=checks` (`listPaymentClaims`, `countOpenPaymentClaims`, `dismissPaymentClaim`), a home warning, and the owner assistant's `paymentChecks` tool. See `docs/decisions/0024`.
- Store checkout (K1): Core `storefront/checkout.ts` (`getStoreCart`, `startStoreCheckout`, `expireStoreCheckouts`, `businessesWithStaleStoreCheckouts`, `getStoreCheckoutSetting` / `setStoreCheckoutEnabled`) and browser-safe `storefront/cart-rules.ts` (cart cookie `CART_COOKIE`, `STORE_CHECKOUT_MINUTES` = 30). Orders are normal orders (channel `store`, actor `customer`) paid through `createPaymentLink` with a `StorefrontActor`; the `store-checkout-expiry` job cancels unpaid ones (`cancelOrderInTx`). Shown only when `StoreInfo.checkout` (setting `store_checkout_enabled` and a payout account). Store pages: `(shop)/cart`, `(shop)/checkout` and plain-form route handlers `cart/add`, `cart/update`, `checkout/start` under `store/[subdomain]` (no JavaScript needed; `lib/cart.ts` reads and writes the cart cookie, remembers the shopper's details and refuses posts from other sites with `fromSameSite`). `CheckoutTotal` only adds a live total. Settings → Store has the switch (`StorePayments`). See `docs/decisions/0025`.
- AI cost (rule 12): log every model call with `recordAiUsage(businessId, { feature, model, tokens })`; prices per model are in `packages/core/src/usage/usage.ts` (unknown models are costed at the highest rate). See `docs/decisions/0009`.
- Assistant: `packages/agent` (`runAgentTurn`) runs in the `agent-reply` job, queued per inbound message a few seconds late; it answers only if that message is still the newest. Core gives it `claimAgentTurn` and `assistant*` tools that act as `AssistantActor` (a `Performer`, checked with `authorize`) and only work while the assistant handles an open chat within the reply window. History is rebuilt as plain text from the database each turn. Any amount in a reply that no tool returned blocks the reply and hands off (`unverifiedAmounts`). Settings in Settings → Assistant (`getAgentSettings` / `saveAgentSettings`). Customer photos: channels store a copy (`storeImage`) on `media.image`; `describeNewPhotos` has Haiku describe each new photo once and saves it on the message (`savePhotoDescription`, `payload.photo`), so history stays text; `searchProducts` ranks by matching words. Models: `AGENT_MODEL` / `AGENT_PHOTO_MODEL`; `pnpm --filter @fulcra/agent measure` compares models on real conversations (real API, costs a little). Tests use a fake Claude HTTP server; `FakePaystack` lives in `@fulcra/core/testing`. See `docs/decisions/0011` and `0012`.
- Payments: links via `createPaymentLink`; Paystack webhooks are saved by `recordPaystackWebhook` and processed in the worker by `processPaystackWebhook`, which verifies with Paystack before confirming (`docs/decisions/0006`). Transfers into customers' dedicated accounts are matched to orders by `recordDedicatedTransfer`; owners resolve the rest with `assignPayment` / `dismissPayment` (`docs/decisions/0007`). Jobs are defined in `packages/core/src/jobs/queue.ts`. In tests, use `setPaystackClient(new FakePaystack())`; never call the real API.
