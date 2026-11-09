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

- Current milestone: **Milestone 3 (The agent on WhatsApp)**, built while the owner confirms the Milestone 2 gate (one design partner on our store, one importing from their own website; at least 3 with real catalogs) and the Milestone 1 gate (core + payments end to end with one real seller's product data)
- Current phase: **A2 — The agent brain**: part A2a (agent, tools, settings, safety rules; tested with a fake Claude API — a real test needs `ANTHROPIC_API_KEY`) done; **A2b** (photos, full scenario suite, model measurement) next
- Completed phases: Week 0 setup, C1 — Accounts and businesses, C2 — Brand kit and catalog (the "20 products in 30 minutes" check with a real seller's products is the owner's to confirm), C3 — Customers, delivery and orders, P1 — Payment links and receipts, P2 — Dedicated virtual accounts, S1 — Simple storefront, A1 — Conversation foundation, I2 — WhatsApp buttons for existing websites, I1 — Catalog import (CSV, Shopify, WooCommerce, website link; tested with fake shops and a fake Claude API — a real Shopify test needs the owner's Shopify app keys, and real website reading needs `ANTHROPIC_API_KEY`) (P1 and P2 tested end to end with a fake Paystack; real test-mode payments need the owner's Paystack test key, and dedicated accounts need Paystack to enable them)
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
- Storefront: pages live in `app/(store)/store/[subdomain]/(shop)` and read through the cached loaders in `apps/web/lib/store.ts` (Core: `getStoreBySubdomain`, `getStoreHome`, `listStoreProducts`, `getStoreProduct`). Server Actions that change what a store shows (products, brand kit, orders) call `refreshStore(actor)`; the cache also expires after 60 seconds for stock changed by the worker. Store pages use plain `<a>` links (no prefetching on slow data) and work without JavaScript. Link previews use JPEG copies from `/api/share-image`.
- Imports: CSV, shop and website imports become `catalog_imports` with one `catalog_import_items` row per product. CSV and website imports wait for the seller's review; `confirmImport` queues the `catalog-import` job, and `processCatalogImport` in the worker saves products one by one with `saveImportedProductInTx` (same rules as the product form; matched by `source` + `external_id`, stock changes recorded as `import`). Anything fetched from a seller's link goes through `safeFetch` (public addresses only; `FETCH_ALLOW_PRIVATE_HOSTS=true` for local testing). Shop connections (`catalog_sources`, one per kind per business) keep their keys encrypted with `encryptSecret` (`ENCRYPTION_KEY`); shop imports skip review: the worker reads the shop with `@fulcra/integrations` (`fetchShopCatalog`), then `saveFetchedProducts` and the usual saving. Shopify connects through our app (OAuth in `app/api/integrations/shopify`), WooCommerce with read-only REST keys. Website imports read the page and its product pages (`extractWebsiteCatalog`): schema.org JSON-LD is used directly, other pages are read by Claude (`URL_EXTRACT_MODEL`, structured output), then wait for review. See `docs/decisions/0008`.
- WhatsApp buttons for sellers' own websites: Settings → WhatsApp buttons (`/settings/whatsapp-buttons`). The link and code builders (`whatsAppLink`, `whatsAppButtonHtml`, `whatsAppFloatingHtml`, `whatsAppProductMessage`) are browser-safe in `@fulcra/core/rules`; generated code is plain HTML with inline styles and every value escaped.
- Conversations: every channel turns platform messages into Core's `InboundMessage` / `OutboundMessage` (`packages/core/src/conversations/message-types.ts`, re-exported by `@fulcra/channels` with the `ChannelAdapter` interface). Incoming: the `inbound-message` job → `receiveInboundMessage` (finds/creates customer and open conversation, saves once by `external_id`, routes to the assistant or marks "needs attention"). Outgoing: `sendHumanReply` (takes over the chat, checks `replyWindow` for the 24-hour rule) → `send-message` job → `claimOutboundMessage` → channel adapter → `markMessageSent`. Test chats use a `mode: 'test'` connection that behaves like WhatsApp and sends nothing. The inbox polls JSON routes in `app/api/inbox` with TanStack Query. See `docs/decisions/0010`.
- AI cost (rule 12): log every model call with `recordAiUsage(businessId, { feature, model, tokens })`; prices per model are in `packages/core/src/usage/usage.ts` (unknown models are costed at the highest rate). See `docs/decisions/0009`.
- Assistant: `packages/agent` (`runAgentTurn`) runs in the `agent-reply` job, queued per inbound message a few seconds late; it answers only if that message is still the newest. Core gives it `claimAgentTurn` and `assistant*` tools that act as `AssistantActor` (a `Performer`, checked with `authorize`) and only work while the assistant handles an open chat within the reply window. History is rebuilt as plain text from the database each turn. Any amount in a reply that no tool returned blocks the reply and hands off (`unverifiedAmounts`). Settings in Settings → Assistant (`getAgentSettings` / `saveAgentSettings`). Tests use a fake Claude HTTP server; `FakePaystack` lives in `@fulcra/core/testing`. See `docs/decisions/0011`.
- Payments: links via `createPaymentLink`; Paystack webhooks are saved by `recordPaystackWebhook` and processed in the worker by `processPaystackWebhook`, which verifies with Paystack before confirming (`docs/decisions/0006`). Transfers into customers' dedicated accounts are matched to orders by `recordDedicatedTransfer`; owners resolve the rest with `assignPayment` / `dismissPayment` (`docs/decisions/0007`). Jobs are defined in `packages/core/src/jobs/queue.ts`. In tests, use `setPaystackClient(new FakePaystack())`; never call the real API.
