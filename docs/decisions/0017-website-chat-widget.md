# 0017 — The website chat widget

Status: accepted (W1)

## Context

Sellers with their own website (and our storefront) need the same assistant on their pages. The script runs on sites we don't control, on cheap phones over slow data: it must be tiny, load after the page, never break the site, and never be broken by it. Visitors are anonymous; AI replies cost money, so a public endpoint must be protected.

## Decision

- **One script, one line**: `<script async src="https://app.yourdomain.com/widget.js" data-fulcra="wk_…">`. `packages/widget` is plain TypeScript (no framework), bundled and minified by esbuild (a build-time tool, approved) into `apps/web/public/widget.js`: about 8 KB, 4 KB compressed. Everything lives in a shadow root (styles isolated both ways); every step is guarded; links are built from text nodes (no HTML from messages). It is cached for ten minutes so updates reach sites quickly.
- **Per-business public key**: turning the chat on creates a `web` connection whose account id is `wk_` + 24 random letters/digits. Turning it off keeps the key for later.
- **Our own small API** (`/api/widget/config`, `/api/widget/messages`) instead of a webhook: messages go through the same `inbound-message` queue, assistant and inbox as other channels; external ids `web:<visitor>:<message>` make a re-sent message count once. The widget polls for replies (every 3 seconds while open, 30 seconds closed when there is a chat), with a "typing…" hint while the assistant works. The web adapter has nothing to send: replies are saved and fetched.
- **Protection**: limits per visitor (15 messages a minute) and per address (40 messages, 120 fetches a minute), in memory per web process. If the business saved its website address, only that site (and subdomains), its Fulcra store, and local development may use the key (CORS checked on every call).
- **Visitors**: a random id kept in the browser is their channel identity, so the chat is there when they come back. The assistant's new `saveCustomerDetails` tool (any channel) saves name and phone; a phone that already belongs to a customer merges the visitor into them (chats, identities, orders, payments, events), so history stays in one place.
- **No 24-hour rule** on the website; replies wait until the visitor returns.
- **Install helpers**: copy-paste code, a WordPress plugin generated with the key inside (a tiny zip writer instead of a library), and "Chat to buy" on our store (falls back to WhatsApp without JavaScript).

## Consequences

- With several web instances, rate limits count per instance; move them to the database or a shared store if needed.
- Visitors can't send photos from the widget yet.
- Polling is simple and works everywhere; server-sent events could replace it later without changing Core.
