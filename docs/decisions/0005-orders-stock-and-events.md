# 0005 — Orders, stock reservation and events

Status: accepted (C3)

## Decisions

- **Stock is reserved when an order is created** (a `sale` stock movement per line) and returned when it is cancelled (`cancellation`). Creating an order fails as a whole if any line is short, and nothing is saved. Two orders racing for the last item cannot both succeed (row lock in `applyStockChange`).
- **Unpaid orders keep their stock until cancelled.** Automatic cancellation of stale unpaid orders comes with payments and follow-ups.
- **Statuses:** new → awaiting_payment → paid → dispatched → delivered, plus cancelled. Allowed moves live in `ORDER_TRANSITIONS` (`packages/core/src/orders/rules.ts`). A paid pickup order goes straight to delivered (collected). Orders can be cancelled until dispatched.
- **Manual payment** (`markOrderPaid`: cash, a transfer the owner checked, POS) sets the order paid until Paystack confirms payments automatically (P1). Transfers should only be confirmed after the money is seen in the bank app, not from a screenshot.
- **Order numbers** (#1001, #1002…) are per business, from `businesses.last_order_number`, incremented in the same transaction (the row lock keeps them unique and gap-free on failure).
- **Prices come from the catalog**, never from the caller: option price or product price, switching to the wholesale price when a line reaches the wholesale minimum. Order items keep a copy of the product name, option and unit price, so receipts never change. An optional order-level discount cannot exceed the total.
- **Customers** are matched by channel identity, then by phone (E.164, unique per business). Same phone at another business is a different customer. A customer's address and delivery area are remembered from their first delivery.
- **Events** (`events` table) are written in the same transaction as the action: `customer.created`, `order.created`, `order.status_changed`, `order.paid`, `order.cancelled`, `stock.low` (once, when stock crosses the low-stock level). They power the order timeline, customer activity and the home feed now, and alerts and jobs later.
- **Who can do what:** owners and staff create, pay and cancel orders; riders can mark orders dispatched and delivered. The assistant (later) will use `createOrderInTx` without `allowHiddenProducts`, so it can never sell hidden products.
