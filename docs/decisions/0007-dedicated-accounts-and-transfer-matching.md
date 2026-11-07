# 0007 — Dedicated accounts and transfer matching (P2)

Status: accepted (P2). Implements `docs/decisions/0002`.

## Decisions

- **One dedicated account per customer per business** (`dedicated_accounts`, unique on business + customer). Created the first time the owner taps "Bank transfer details" on an order, then reused. Linked to the business's Paystack subaccount, so transfers settle to the seller.
- **A separate Paystack customer per business-customer pair**, using the email `dva-<customer id>@customers.<domain>`. The same person buying from two businesses therefore gets two accounts, and money can never land in the wrong business's subaccount.
- **Requirements:** payouts set up, and the customer has a name and phone (Paystack needs them). Bank: `PAYSTACK_DVA_BANK`, defaulting to `test-bank` with a test key and `wema-bank` with a live key. If Paystack refuses (e.g. dedicated accounts not enabled for the integration), the attempt is marked failed and the owner is told to send a payment link instead (it also accepts transfers).
- **Matching (worker).** A `charge.success` whose reference is not one of our payment links is looked up by the Paystack customer code of a dedicated account. The transaction is verified with Paystack, and the verified customer code must equal the account's. The payment is recorded once (unique reference). It is matched to that customer's **oldest unpaid order whose total equals the amount exactly** (orders with nothing paid yet). Otherwise it is `unmatched` with a reason, and a `payment.unmatched` event is written.
- **No guessing.** Different amounts are never split across orders or treated as part payments (part payments are a later feature). Under a tight race, a second transfer may go to "To match" rather than wait; it is never counted twice.
- **Owner actions** (Payments page): assign an unmatched payment to an unpaid order with exactly that total, or mark it "not for an order" with a note (`dismissed`). Both are owner or staff only.
- **Payments without an order.** `payments.order_id` is now optional and `payments.customer_id` records who paid. New statuses: `unmatched`, `dismissed`.

## Testing

- Core tests use the in-memory fake Paystack (`transfer()` simulates a customer's bank transfer and its signed webhook).
- End-to-end with a local fake Paystack HTTP server: pay by link and pay by transfer each marked the right order paid with a receipt; a wrong amount went to "To match"; an early transfer was assigned to a new order.
- Real accounts need Paystack to enable dedicated virtual accounts on the integration.
