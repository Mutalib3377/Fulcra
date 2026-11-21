# 0025 — Store checkout (cart and payment on the store)

Status: accepted (K1a core, K1b pages). Moved ahead of launch at the owner's request; free in every plan (the product plan had it in a later "Storefront Pro").

## Context

Stores were catalogues: every order went through a WhatsApp chat before the customer could pay. Many shoppers would rather add to cart and pay at once, and every chat step loses some of them.

## Decision

- **Same order, same payment.** A store checkout creates a normal order with `createOrderInTx` (channel `store`, actor `customer`): prices, wholesale, stock and delivery fees come from the database, and stock is held at once. Payment is the usual Paystack link (`createPaymentLink`) settled to the seller's subaccount, with the store's receipt page as the return address; Paystack's webhook marks the order paid as before (`docs/decisions/0006`). Nothing new touches money.
- **A new performer.** `StorefrontActor` (`{ businessId, storefront: true }`) joins the member and the assistant in `Performer`; only `startStoreCheckout` creates it. `performerActor` turns any performer into an event actor.
- **Cart in a cookie** (`CART_COOKIE`, variant ids and quantities only, `parseCart` / `serializeCart` in `storefront/cart-rules.ts`, browser-safe), so the store works without JavaScript. `getStoreCart` prices it from the database and flags lines that are hidden, archived or short of stock.
- **Holding stock safely.** Unpaid store orders are cancelled after `STORE_CHECKOUT_MINUTES` (30) by the `store-checkout-expiry` job (every 5 minutes: `businessesWithStaleStoreCheckouts`, a cross-business list in `0003`, then `expireStoreCheckouts`, re-checked under the row lock) and their stock returns (`cancelOrderInTx`, now shared with the dashboard's cancel). Money that arrives after that is flagged for review like any payment for a cancelled order. A new checkout from the same phone cancels that phone's earlier unpaid store order first. Checkouts are limited per device (8 an hour) and per phone (6 an hour) with `consumeRateLimit`. If Paystack can't open the payment page, the order is cancelled at once.
- **Only when the seller can be paid.** `businesses.store_checkout_enabled` (default on; Settings → Store, owner only: `setStoreCheckoutEnabled`) and a payout account; `StoreInfo.checkout` tells the store. Otherwise the store stays "Order on WhatsApp", which also stays available next to checkout.

- **Pages (K1b).** Add to cart, the cart and checkout are plain forms posting to route handlers on the store address (`cart/add`, `cart/update`, `checkout/start`), which answer with redirects, so they work without JavaScript; posts from other sites are refused. Checkout problems come back to the form as a message, with what the shopper typed kept in a cookie on their phone (also used to fill the form next time). A cancelled unpaid order's receipt link says so. Without store payments, the cart becomes a ready-made WhatsApp order message.

## Consequences

- Store orders appear in the dashboard like others (channel "Store"); the paid-order alert and receipts work unchanged.
- Discounts, coupons and pay on delivery are not part of checkout yet.
