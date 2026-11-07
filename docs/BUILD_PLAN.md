# Build plan — Fulcra

The order we build in. Work top to bottom, one phase at a time.

- Tick a task (`- [x]`) only when it works and type-check, lint and tests pass.
- A phase is finished when its **Done when** check passes.
- A milestone is finished when its **Gate** is met. Do not start the next milestone before that.
- Tasks marked **(owner)** are done by the product owner outside the code. Everything else is a coding task.

```
Week 0 → M1 Lean Core + Payments → M2 Store + Website connection → M3 Agent + WhatsApp → M4 Instagram, Widget, Billing → LAUNCH → post-launch phases
```

---

## Week 0 — Setup

### Decisions (owner)

- [x] Product name: **Fulcra**
- [ ] Domain
- [ ] First seller category
- [ ] Confirm Render + Cloudflare setup supports wildcard subdomains (`*.yourdomain.com`)

### Accounts (owner)

- [x] GitHub repo
- [ ] Supabase project (EU region)
- [ ] Paystack account (test mode)
- [ ] Ask Paystack to enable **dedicated virtual accounts** and **subaccounts/splits** on our account (needs approval)
- [ ] Meta Business account — **start Business Verification now**
- [ ] Register as a Meta **Tech Provider** (required to onboard other businesses' WhatsApp numbers with embedded signup)
- [ ] Meta developer app with WhatsApp and Instagram products added (test number + own Instagram professional account for testing)
- [ ] Anthropic API key with a monthly spending limit
- [ ] Cloudflare account (DNS, R2)
- [ ] Sentry and PostHog projects (free tiers)

### Repo scaffold

- [x] pnpm workspaces + Turborepo: `apps/web`, `apps/worker`, `packages/{core,agent,channels,integrations,modules,widget,db,ui,config}`
- [x] Shared TypeScript (strict), ESLint, Prettier configs in `packages/config`
- [x] `apps/web`: Next.js (App Router) + Tailwind + shadcn/ui
- [x] `apps/worker`: Node + TypeScript entry that connects to pg-boss and logs "worker ready"
- [x] `packages/db`: Drizzle setup, db client, migration scripts
- [x] Local Postgres via Supabase CLI (or Docker) with a documented start command (Docker: `pnpm db:up`)
- [x] Vitest set up
- [x] `.env.example` with every variable documented
- [x] Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:generate`, `db:migrate`
- [x] Dockerfiles for `apps/web` and `apps/worker`
- [x] Host routing in `apps/web/proxy.ts`: root domain → marketing, `app.` → dashboard, other subdomains → store. Works locally with `*.localhost:3000`
- [x] App constants (name, domain) in one config file
- [x] Base UI kit in `packages/ui`: colours, typography, button, input, card, table, badge, empty/loading/error states
- [x] GitHub Actions: lint, type-check, tests on every pull request
- [x] Fill in "Commands" in `CLAUDE.md`

**Done when:** `pnpm dev` starts web and worker; `app.localhost:3000` shows a dashboard placeholder; `test.localhost:3000` shows a store placeholder; CI passes.

---

## Milestone 1 — Lean Core + Payments

Goal: an owner can sign up, set up brand and catalog, record orders, and get paid through links and a dedicated account.

### C1 — Accounts and businesses

- [x] Schema: `businesses`, `members` (owner, staff, rider)
- [x] Tenant-scoped query helpers in `packages/db` (every query requires `businessId`)
- [x] RLS policies on business-owned tables: app connects as a restricted role and sets `app.business_id` per transaction (`docs/decisions/0003`)
- [x] `canUse(businessId, featureKey)` stub in `packages/core/entitlements` (always allows; replaced in B1)
- [x] Auth with Supabase (email OTP for development)
- [x] Onboarding step 1: business name, category, WhatsApp number, subdomain (live availability check; reserved words: `app`, `www`, `api`, `admin`, `widget`)
- [x] Invite staff with a role (invite link shared by copy or WhatsApp; `member_invites` table)
- [x] Dashboard shell: mobile-first (bottom nav on mobile, sidebar on desktop)
- [x] Tests: tenant isolation

**Done when:** two test businesses exist and neither can see the other's data.

### C2 — Brand kit and catalog

- [x] Schema: `brand_kits`, `products`, `product_variants` (with `source` and `external_id`)
- [x] Image upload to R2 with resizing (S3 API: Supabase Storage locally, R2 in production via `STORAGE_*`)
- [x] Brand kit page: logo, colours, font, brand voice, description
- [x] Product form: photos, description, category, retail price, wholesale price + min quantity, minimum price
- [x] Variants editor (size, colour) with stock per variant
- [x] Product list: search, category filter, low-stock badge, active toggle
- [x] Core services + tests: create/update product, adjust stock, low-stock detection
- [x] Schema: `stock_movements` (history of every stock change, `docs/decisions/0004`)

**Done when:** a seller can add 20 real products with variants in under 30 minutes.

### C3 — Customers, delivery and orders

- [x] Schema: `customers`, `customer_identities`, `delivery_zones`, `orders`, `order_items`, `events`
- [x] Customers list and profile (contacts, history, tags, notes)
- [x] Delivery zones page
- [x] Core services + tests: `createOrder` (reserves stock), `updateOrderStatus`, `cancelOrder` (returns stock), `findOrCreateCustomer` (by phone or channel identity)
- [x] Manual order form; orders list (filter by status); order detail page
- [x] Events written for important actions; activity feed

**Done when:** an owner records a full order from new to delivered; stock and history update correctly.

### P1 — Payment links and receipts

- [x] Paystack client in `packages/core/payments`
- [x] Seller payout setup: bank account → Paystack subaccount per business (`docs/decisions/0001`)
- [x] Schema: `payments`, `webhook_events`
- [x] Payment link per order (`createPaymentLink(orderId)`), settled to the seller's subaccount
- [x] Webhook: verify signature → save to `webhook_events` (unique event id) → enqueue → 200
- [x] Worker: confirm payment, mark order paid, write `payment.confirmed` event
- [x] Receipt page + PDF
- [x] Tests: duplicate webhooks never double-count

### P2 — Dedicated virtual accounts

- [x] Dedicated virtual account per **customer of a business** (Paystack DVA linked to the seller's subaccount), created on first order (`docs/decisions/0002`)
- [x] Incoming transfers matched to that customer's open orders (exact amount first, then oldest unpaid); anything else goes to unmatched
- [x] Fallback when DVA is not available: bank transfer through the payment link
- [x] "Unmatched payments" list with manual assignment
- [x] `payment.unmatched` event

**Done when:** test payments by link and by transfer both mark the right order paid and produce a receipt.

### Gate to Milestone 2

- [ ] Core + payments work end to end with one real seller's product data

---

## Milestone 2 — Simple store + website connection

Goal: design partners can share a store link or connect their existing website, while Meta verification is in progress.

### S1 — Simple storefront

- [x] Store resolves business from subdomain; friendly 404
- [x] Theme from brand kit
- [x] Home: hero, featured products, categories
- [x] Product page: photos, variants, price, stock status
- [x] "Order on WhatsApp" button (pre-filled message with product name and variant) and "Chat to buy" (opens widget later — the button is added in W1, so customers never see a button that does nothing)
- [x] Open Graph previews for shared links
- [x] Caching per business, revalidated on product changes

### I1 — Catalog import

- [ ] Schema: `catalog_sources`
- [ ] Onboarding choice: "Use our store" or "Connect my website"
- [ ] CSV import with a template file and a review screen
- [ ] Shopify import (Admin API): products, variants, prices, stock, images
- [ ] WooCommerce import (REST API keys): products, variations, prices, stock, images
- [ ] URL import: fetch the seller's site, AI extracts products → **seller reviews and approves before saving**
- [ ] Import runs as a background job with progress shown in the dashboard
- [ ] Re-import updates existing products by `external_id` (no duplicates)

### I2 — WhatsApp buttons for existing websites

- [ ] Page in dashboard that generates "Chat on WhatsApp" buttons/links (per product and general) with copy-paste code

**Done when:** one design partner uses our store and one imports from their own website.

### Gate to Milestone 3

- [ ] At least 3 design partners set up with real catalogs

---

## Milestone 3 — The agent on WhatsApp

Goal: the agent sells on WhatsApp end to end, the owner can watch and take over, and gets alerts.

### A1 — Conversation foundation

- [ ] Standard types in `packages/channels`: `InboundMessage`, `OutboundMessage`, `ChannelAdapter` interface (parse webhook, send text, send image, send buttons/list where supported)
- [ ] Schema: `channel_connections`, `conversations`, `messages`, `agent_settings`, `agent_actions`
- [ ] Encrypted token storage for channel connections
- [ ] Inbound pipeline: webhook → save → enqueue → worker → find/create customer and conversation → route to agent or human
- [ ] Unified inbox in dashboard: conversation list (channel icon, status, needs-attention), chat view, reply as human, "Take over" / "Give back to agent"
- [ ] Track `last_customer_message_at` and block free-form replies outside the 24-hour window

### A2 — The agent brain (`packages/agent`)

- [ ] System prompt built from brand kit, agent settings, policies and business info (with prompt caching for stable parts)
- [ ] Tools (each calls Core services with Zod-validated input):
  - `searchProducts`, `getProduct`, `checkStock`, `suggestAlternatives`
  - `getDeliveryFee`, `getBusinessInfo`
  - `createOrder`, `sendPaymentLink`, `sendAccountDetails`, `checkPaymentStatus`, `getOrderStatus`
  - `getCustomerHistory`, `tagCustomer`
  - `handOffToHuman`
- [ ] Image matching: customer photo/screenshot → closest products (image embeddings or vision model; propose approach first)
- [ ] Retail vs wholesale pricing by quantity
- [ ] Never states a price, stock level or payment status that did not come from a tool
- [ ] Handoff when unsure, customer upset, asks for a human, or topic is in `handoff_topics`
- [ ] Away message outside business hours (agent still takes orders if owner allows)
- [ ] Schema: `usage_records` (created here, used again in B1)
- [ ] Every tool call logged to `agent_actions`; every model call logged to `usage_records` with cost
- [ ] Model choice per task (cheaper model for simple replies)
- [ ] Scenario tests: price question, screenshot, variant out of stock, wholesale quantity, full order + payment, "I've sent it" with no payment, handoff

### A3 — WhatsApp adapter

- [ ] Connect a business's number (Cloud API embedded signup)
- [ ] Webhook handler + signature check
- [ ] Send text, images, interactive buttons/lists
- [ ] Message templates for receipts, order updates, alerts and briefings (submitted to Meta)
- [ ] Conversation usage metered per business

### A4 — Owner alerts and daily briefing

- [ ] Owner WhatsApp number in settings
- [ ] Alerts: new paid order, low stock, unmatched payment, customer waiting for a human
- [ ] Daily briefing at the owner's chosen time (sales, pending, unpaid, low stock)
- [ ] Agent settings page: tone, hours, away message, return/refund policy, payment options, handoff topics, alerts on/off

**Done when:** in a test week with a design partner on WhatsApp, the agent completes orders end to end, hands off cleanly, and the owner receives alerts and briefings.

### Gate to Milestone 4

- [ ] Design partners use the WhatsApp agent daily for at least one week

---

## Milestone 4 — Instagram, website widget, billing → LAUNCH

### G1 — Instagram adapter

- [ ] "Connect Instagram" (Instagram Login), long-lived token storage and refresh
- [ ] Webhook (`messages`, `messaging_postbacks`) + signature check
- [ ] Send text and images; map to the standard message types
- [ ] Respect the 24-hour window; human replies supported in the inbox
- [ ] Screen recording + App Review submission for Advanced Access (owner)

### W1 — Website chat widget

- [ ] `packages/widget`: tiny async script, isolated styles (shadow DOM), brand colours, mobile friendly
- [ ] Widget API routes in `apps/web/app/api/widget` (rate limited, per-business public key)
- [ ] Visitor identity: anonymous session → ask for name/phone when ordering → links to customer
- [ ] Copy-paste install code in the dashboard; simple WordPress plugin
- [ ] "Chat to buy" on our storefront opens the widget

### B1 — Entitlements and billing

- [ ] Schema: `plans`, `entitlements`
- [ ] `canUse(businessId, featureKey)` and `recordUsage(...)` with tests; wired into agent and channels
- [ ] Conversation limits per plan; friendly warning at 80% and at the limit
- [ ] Owner subscription via Paystack: plans, 14-day trial, upgrade, cancel
- [ ] Billing page: plan, usage, invoices

### L1 — Launch readiness

- [ ] Onboarding flow polished end to end (business → brand → store/website → products → delivery → payments → channels → test chat)
- [ ] Dashboard home: today's sales, orders by status, chats needing attention, low stock
- [ ] Marketing landing page with pricing and sign-up
- [ ] Deploy to Render (web + worker, Starter, EU); Cloudflare wildcard DNS
- [ ] Sentry and PostHog in production; uptime check on webhooks
- [ ] Switch Paystack to live mode (owner)
- [ ] Privacy policy and terms (needed for Meta reviews) (owner)

### Launch gate

- [ ] WhatsApp live for real sellers (Business Verification approved)
- [ ] Billing works with a real payment
- [ ] Instagram live, or launch without it and switch on when App Review is approved

---

## After launch — same module, then new modules

Plan each in detail only when its turn comes. Suggested order (seller feedback can change it):

1. Owner commands by chat (sales questions, add product from photo, update stock, mark dispatched)
2. Delivery updates, feedback requests, complaints and returns
3. Follow-ups on unfinished orders and broadcasts (WhatsApp templates, opt-in)
4. Bargaining within limits; voice notes; Pidgin and local languages
5. Pay on delivery, part payments, balances owed
6. Two-way Shopify / WooCommerce sync
7. Facebook Messenger adapter; Instagram comment replies
8. Staff and rider assignment by chat
9. New modules: Storefront Pro, Content Studio, Strategist, Debt Recovery

---

## Alongside the build (owner)

- Week 0: start Meta Business Verification; interview 15–20 sellers in the chosen category; test prices.
- Milestone 1: recruit 5–10 design partners; collect their product lists.
- Milestone 2: onboard design partners onto the store or website connection.
- Milestone 3 onward: weekly check-in with each design partner; reorder the backlog from their feedback.
