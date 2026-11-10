# Product plan — Fulcra

This document explains **what** we are building and **why**. For build order and task lists, see `BUILD_PLAN.md`.

Labels used below: **[Launch]** = in the first release. **[Later]** = added to the same module after launch.

## 1. The problem

Small product sellers in Nigeria run their business on WhatsApp, Instagram and sometimes a website. Every day they:

- answer the same questions about price, stock, sizes and delivery, often late or never;
- receive orders scattered across chats and platforms;
- check bank alerts by hand, match payments to customers and watch out for fake alerts;
- send receipts manually, track stock loosely, and forget who still owes them;
- have no clear picture of what sells or what to do next.

Many hire a virtual assistant for this, or simply lose sales.

## 2. The solution

An **AI sales agent** that works like a full-time virtual assistant across **WhatsApp, Instagram DMs and the seller's website**. It answers, sells, takes orders, confirms payments and reports to the owner.

Promise: **"Run your business like you have three staff, without paying three salaries."**

## 3. Target customer

- Product sellers (fashion, beauty, food, gadgets) selling on WhatsApp and Instagram, with or without a website.
- Start with **one category** for the first 10–20 customers (to be decided).

## 4. The Core (included in every plan)

The shared business brain everything reads from and writes to: business accounts, team and roles; brand kit; product catalog (photos, variants, stock, retail/wholesale prices, minimum price); customers; orders; delivery zones; payments; events; entitlements, billing and usage.

## 5. Module 1 — AI Sales Agent (the launch)

### 5.1 Channels

- **[Launch]** WhatsApp (Cloud API)
- **[Launch]** Instagram DMs (Instagram API with Instagram Login)
- **[Launch]** Website chat widget (one line of code or a WordPress plugin)
- **[Later]** Facebook Messenger; Instagram comment replies ("Price?" → reply or move to DM); other platforms when their APIs allow

### 5.2 Store or website (seller chooses at onboarding)

**Option A — "Use our store"**
- **[Launch]** Simple storefront at `brandname.yourdomain.com`, styled from the brand kit: home, product pages, "Order on WhatsApp" / "Chat to buy" buttons, payment links.
- **[Later]** Cart and checkout, discounts, themes, custom domains.

**Option B — "Connect my website"**
- **[Launch]** Chat widget on their site (same agent).
- **[Launch]** "Chat on WhatsApp" buttons and links for their pages.
- **[Launch]** Catalog import: Shopify and WooCommerce via API; any other site via CSV, or paste the website link and AI extracts products for the seller to review.
- **[Later]** Two-way sync with Shopify / WooCommerce (stock in, orders out).
- **[Later]** Connect their own domain to our storefront.

### 5.3 Agent — talking to customers

Answering and selling
- **[Launch]** Replies instantly, 24/7, on every connected channel.
- **[Launch]** Answers price, size, colour, availability, delivery fee and time, location, hours, payment options — only from the seller's real data.
- **[Launch]** "How much is this?" with a screenshot → matches the image to catalog products.
- **[Launch]** Sends product photos, prices and links.
- **[Launch]** Suggests alternatives when out of stock; suggests matching items; mentions active promos.
- **[Launch]** Applies retail vs wholesale price by quantity.
- **[Later]** Bargains within the owner's minimum price.
- **[Later]** Voice notes; Pidgin, Yoruba, Hausa, Igbo (Pidgin text may come early).

Orders and payments
- **[Launch]** Collects item, variant, quantity, name, phone, address or location pin.
- **[Launch]** Calculates delivery fee from zones; confirms the total.
- **[Launch]** Sends a payment link or the customer's dedicated account number for that seller. Money settles straight to the seller's bank account (Paystack subaccount); Fulcra never holds sellers' funds.
- **[Launch]** Confirms payment automatically, sends a receipt, records the order.
- **[Launch]** Flags payment claims that don't match ("I've sent it" but nothing received).
- **[Later]** Pay on delivery, part payments, balances owed.

After the sale
- **[Launch]** Answers "Where is my order?" from order status.
- **[Later]** Automatic dispatch and delivery updates.
- **[Later]** Feedback and reviews after delivery.
- **[Later]** Complaints and returns by the seller's policy, escalating when needed.
- **[Later]** Follow-ups on unfinished orders; broadcasts to opted-in customers by segment (WhatsApp, within Meta rules).

Remembering customers
- **[Launch]** Recognises returning customers across channels: name, address, past orders.
- **[Launch]** Auto-tags customers (new, repeat, wholesale, owes money).

### 5.4 Agent — working for the owner

- **[Launch]** WhatsApp alerts: new paid order, low stock, unmatched payment, customer waiting for a human.
- **[Launch]** Daily briefing: sales, pending orders, unpaid orders, low stock.
- **[Later]** Owner commands by chat: "today's sales", "who hasn't paid?", "best seller", add product from a photo, update stock, mark dispatched, create invoice, send promo to a segment.
- **[Later]** Reminders and to-dos (supplier reorders, follow-ups).
- **[Later]** Assign orders to staff and riders; they update status by chat.

### 5.5 Owner control and safety

- **[Launch]** One-tap take over of any chat; give it back to the agent.
- **[Launch]** Automatic handoff when the agent is unsure, the customer is upset or asks for a human, or the topic is on the owner's "always ask me" list.
- **[Launch]** The agent never invents prices, stock or promises; everything comes from the database.
- **[Launch]** Settings: tone, business hours, away message, return/refund policy, payment options, delivery zones.
- **[Later]** Limits: maximum discount, whether refunds can be promised.

### 5.6 The app (dashboard)

- **[Launch]** Onboarding: business details, brand kit, store-or-website choice, product import, delivery zones, payment setup, connect WhatsApp / Instagram / widget.
- **[Launch]** Unified inbox: all chats from all channels; who is handling each (agent or human); chats needing attention.
- **[Launch]** Catalog, Orders, Customers, Payments (confirmed, unmatched, receipts).
- **[Launch]** Home: today's sales, orders by status, chats needing attention, low stock.
- **[Launch]** Billing: plan, trial, usage, invoices. Team: invite staff with roles.
- **[Later]** Weekly performance summary (bridge to the Strategist module).

### 5.7 Behind the scenes

- **[Launch]** Usage and cost tracking per business (conversations, AI calls, limits).
- **[Launch]** Audit trail of everything the agent said and did.
- **[Launch]** Data isolation between businesses; encrypted tokens; idempotent webhooks.

## 6. Later modules (paid add-ons)

- **Storefront Pro** — cart and checkout, discounts, themes, custom domains, analytics.
- **Content Studio** — branded promo templates with real product photos; AI captions and backgrounds; content calendar; auto-publish to Instagram/Facebook; one-tap WhatsApp Status share.
- **Strategist** — weekly reports; gap detection (stock, lapsed customers, unanswered chats); next-move recommendations with one-tap actions; goals.
- **Debt Recovery** — who owes what; scheduled polite reminders with payment links.

Flywheel: orders fill the database → Strategist finds patterns → Content Studio turns them into promos → promos bring customers back to the agent and store.

## 7. Platform rules we must design around

- **WhatsApp:** official Cloud API; Meta business verification; free-form replies within 24 hours of the customer's last message; outside that, only Meta-approved templates; marketing needs opt-in and costs more; no API posting to Status.
- **Instagram:** seller needs an Instagram professional (business or creator) account; serving other businesses needs Advanced Access (App Review + Business Verification) — App Review needs a screen recording of the working feature; 24-hour reply window and no template system for later messages.
- Business Verification is shared across WhatsApp and Instagram — start it early.

## 8. Pricing (placeholders, to test with sellers)

| Plan | Includes | Placeholder price |
| --- | --- | --- |
| Starter | Core + agent on 1 channel + simple store or website connection + payments | ₦10,000–₦15,000 / month |
| Growth | All channels + owner alerts and briefing + higher conversation limit | ₦20,000–₦35,000 / month |
| Pro | Growth + later modules as they launch | ₦40,000–₦60,000 / month |

- Usage limits on every plan (agent conversations). Add-ons: extra conversations, staff seats, custom domain.
- 14-day free trial. Annual plans at a discount.
- We earn in Naira but pay most providers in dollars: margin buffer, regular price reviews, monthly cost-per-business review.

## 9. Data model (main tables)

Every business-owned table has `business_id`. Amounts are integers in kobo.

| Table | Key fields |
| --- | --- |
| businesses | name, subdomain, category, plan, timezone, has_external_website, website_url, paystack_subaccount_code |
| members | business_id, user_id, role (owner / staff / rider) |
| brand_kits | business_id, logo_url, colours, font, voice, description |
| products | business_id, name, description, category, photos, retail_price, wholesale_price, wholesale_min_qty, min_price, is_active, is_featured (shown on the store home page), source (manual / shopify / woocommerce / csv / url), external_id |
| product_variants | business_id, product_id, size, colour, sku, stock, price_override, is_default, archived_at, external_id |
| stock_movements | business_id, variant_id, change, stock_after, reason, note, created_by (history of every stock change) |
| catalog_sources | business_id, type, credentials (encrypted), last_synced_at, status |
| catalog_imports | business_id, source_id, kind (csv / shopify / woocommerce / url), status, label, progress and result counts, error |
| catalog_import_items | business_id, import_id, position, source_ref, data (product as read), problems, decision, result, product_id |
| customers | business_id, name, phone, tags, marketing_opt_in, notes, paystack_customer_code, dedicated_account (bank, number, name) |
| customer_identities | customer_id, channel, external_user_id (one customer, many channel identities) |
| delivery_zones | business_id, name, fee, estimated_time |
| orders | business_id, order_number, customer_id, status, channel, fulfilment (delivery / pickup), subtotal, delivery_fee, discount, total, amount_paid, payment_method, delivery_zone_id + name copy, address, timestamps per status |
| order_items | order_id, variant_id, product_id, product_name + variant_label copies, quantity, unit_price, is_wholesale, line_total |
| payments | business_id, order_id (optional), customer_id, provider (paystack / manual), reference (unique per provider), amount, status (pending / success / failed / needs_review / unmatched / dismissed), method, checkout_url, paid_at |
| dedicated_accounts | business_id, customer_id (unique per business), provider customer code, account_number, account_name, bank_name, status |
| channel_connections | business_id, channel, mode (live / test), external_account_id, external_business_id (WhatsApp Business Account), display_name, credentials (encrypted), status, expires_at |
| conversations | business_id, customer_id, connection_id, channel, status, handled_by (agent / human), needs_attention, attention_reason, last_customer_message_at, last_message_at, last_message_preview, unread_count |
| messages | conversation_id, direction, sender (customer / agent / human / system), sent_by_user_id, type, text, media, payload, external_id (unique), status (received / queued / sent / delivered / read / failed), created_at |
| agent_settings | business_id, enabled, greeting, away_message, business_hours, after_hours_orders, policies, handoff_topics (tone comes from the brand kit) |
| message_templates | business_id, connection_id, purpose, name, language, category, body, status (not_submitted / pending / approved / rejected / paused / disabled), external_id, status_reason |
| agent_actions | conversation_id, message_id, tool, input, output, ok, created_at (audit trail) |
| webhook_events | provider, event_id (unique per provider), event_type, payload, processed_at, attempts, last_error (system-only) |
| plans / entitlements | plan features and limits; per-business switches |
| usage_records | business_id, kind (ai_call, whatsapp_message), feature, model, input_tokens, output_tokens, quantity, reference (provider id, unique per kind), cost_usd, created_at |
| events | business_id, type, actor (user / system / agent / customer), order_id, customer_id, payload, created_at |

Order statuses: `new → awaiting_payment → paid → dispatched → delivered`, plus `cancelled`.

## 10. Hosting and costs

- Development: everything local, free tiers only.
- Launch: Render (web + worker, Starter, EU region), Supabase Postgres (EU), Cloudflare (DNS, CDN, wildcard subdomains), R2 (images).
- Biggest variable costs are AI and WhatsApp: cheaper model for routine replies, prompt caching for catalog context, hard usage caps, cost tracking per business.

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Meta verification / App Review delays | Start Business Verification in Week 0; storefront and payments go to design partners first; launch WhatsApp even if Instagram review is pending |
| Agent gives wrong price or promise | Answers only from DB; tools validate input; handoff when unsure; audit trail |
| AI cost per business | Usage limits, cheaper models, prompt caching, cost tracking |
| Data leak between businesses | `business_id` scoping + RLS (restricted app role) + isolation tests |
| Holding sellers' money (regulatory risk) | All payments settle to the seller's Paystack subaccount; we only take our fee by subscription |
| Catalog import mess (bad data from sites) | Seller reviews imported products before they go live |
| Widget breaks seller's site | Tiny async script, isolated styles (shadow DOM), no global side effects |
| Building too much before launch | Strict [Launch] scope; everything else is [Later] |
| Exchange rate | Price buffer, annual plans, monthly cost review |

## 12. Open decisions

- [x] Product name: Fulcra
- [ ] Domain
- [ ] First seller category
- [ ] Login method for launch (email OTP vs phone OTP via SMS provider)
- [ ] Final prices after seller interviews
