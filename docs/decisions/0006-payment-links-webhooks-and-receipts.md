# 0006 — Payment links, webhooks and receipts

Status: accepted (P1)

## Decisions

- **Payout setup.** The owner adds a bank account (Settings → Get paid). Fulcra checks the account name with Paystack, then creates or updates the business's Paystack subaccount (`percentage_charge: 0`). Only the bank name, account name and last 4 digits are stored; Paystack keeps the full number. Owner only.
- **Payment links** use Paystack Transaction Initialize for the exact order total, `subaccount` = the business, and **`bearer: subaccount`: the seller pays Paystack's fee** from their settlement. A pending link for the same amount is reused for 24 hours. Creating a link moves a new order to "awaiting payment". If Paystack fails, the attempt is marked failed and the order is unchanged.
- **Customer email.** Paystack requires one. Customers without an email get `<phone digits>@customers.<domain>` (or `order-…@customers.<domain>`). These addresses are never used to send email.
- **Webhooks (rules 8 and 9).** `POST /api/webhooks/paystack` checks the `x-paystack-signature` HMAC-SHA512 with the secret key, saves the raw event once (`webhook_events`, unique `provider` + `event:transaction id`), enqueues a `paystack-webhook` job and answers 200. A duplicate that was saved but never processed (e.g. queueing failed) is queued again; processing is idempotent, so this is always safe. `webhook_events` is system-only (RLS on, no policy).
- **Never trust the webhook alone.** The worker calls Paystack's verify endpoint and confirms only `status: success` with the **exact amount** in NGN. A different amount, money for a cancelled order, or a second payment for an already-paid order sets the payment to `needs_review` (event `payment.needs_review`) and does not change the order. A not-yet-successful verify throws, so the job retries with backoff.
- **Exactly once.** The payment row is locked during confirmation and `payments(provider, reference)` is unique, so retries, duplicate deliveries and parallel jobs confirm a payment once (`payment.confirmed` event once).
- **Manual payments** ("Mark as paid": cash, a transfer the owner checked, POS) also create a `payments` row (`provider: manual`), so all money is in one table.
- **Receipts** live on the business's store address: `https://<subdomain>.<domain>/receipt/<token>`, where the token is a random 128-bit value on the order. The page shows "confirming your payment" and refreshes itself until the order is paid. A PDF is generated on the server with `pdf-lib`. The built-in PDF fonts have no ₦ sign, so the PDF shows amounts as "NGN 15,000.00".

## Testing

- Core tests use an in-memory fake Paystack (`packages/core/test/fake-paystack.ts`) and signed webhooks.
- End-to-end, a small fake Paystack HTTP server was used locally (`PAYSTACK_BASE_URL`). A real test-mode payment needs the owner's Paystack test key and a public webhook URL (Cloudflare Tunnel).

## Not done yet (P2 and later)

- Dedicated bank accounts per customer and matching transfers (P2).
- Refunds, partial payments, and automatic cancellation of stale unpaid orders.
