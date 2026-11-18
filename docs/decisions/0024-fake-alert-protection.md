# 0024 — Fake alert protection (payment claims)

Status: accepted (F1a core, F1b seller-facing). Added before launch at the owner's request.

## Context

Fake bank alerts are a common fraud against Nigerian sellers: a customer sends an edited transfer screenshot or SMS alert, the seller sends the goods, and no money ever arrives. A good fake image can look perfect, so judging the picture is not enough. What Fulcra can know for sure is whether the money actually arrived through Paystack (payment link or the customer's own transfer account).

## Decision

- **A claim, never a payment.** When a customer sends a payment screenshot or says they paid, Core saves a `payment_claims` row. It is a record of what the customer *claimed*; it never marks an order paid. Payment status keeps coming only from Paystack (`docs/decisions/0006`, `0007`).
- **Two sources.** Screenshots: the photo step (`describeNewPhotos`) also reads the receipt (amount, bank, sender name, reference, date and time) into `payment` on the photo description; `savePhotoDescription` then calls `recordScreenshotClaimInTx` (once per message). "I've paid": the assistant calls `checkPaymentStatus` with `customerSaysPaid: true`, which calls `recordSaidPaidClaimInTx` (one open claim per order; a later screenshot fills in the same claim).
- **Which order.** The customer's unpaid order the screenshot pays exactly, else the newest unpaid one, else none (checked against any payment from that customer).
- **Checking.** The `payment-claims` job runs every minute for businesses with open claims (`businessesWithOpenClaims`, a cross-business list in `0003`) and calls `sweepPaymentClaims`: money arrived (the order is paid, or for a claim with no order a successful payment from that customer from up to 2 hours before) → `confirmed`. Nothing after `CLAIM_WAIT_MINUTES` (20) → `not_received` and a `payment.claim_unverified` event; if money arrives later, `confirmed` and `payment.claim_cleared`. While an unmatched transfer from the same customer waits for the owner, no warning is raised (the owner already has "a payment to check"). Claims for cancelled orders are closed quietly. Claims older than 7 days stop being checked.
- **Red flags** (`claimFlags`, worked out once when the claim is made, shown to the owner as hints): the amount isn't what the order costs or still owes; the receipt is dated more than 30 minutes before the order; the receipt shows a time in the future; the same receipt reference (letters and digits only, 6 or more) was already used for another order or customer of this business. Receipt times are read as Lagos time (UTC+1, no daylight saving).
- **The customer assistant** gets the claim in `checkPaymentStatus` with a note: never say it's paid, payments confirm automatically; after 20 minutes, say the team will check and hand off. It may mention a screenshot amount that differs from what's owed (the amounts come from the tool), but never accuses the customer.
- **Owner side (F1b).** Sellers see claims as "payment checks".
  - **WhatsApp alert** `payment_claim` (template `fulcra_alert_payment_check_v1`) for each `payment.claim_unverified`: who, how much, when, the warning signs, and "please do not send the goods until it does". It sits under the existing "Payment to check" switch in Settings → Alerts and, like every WhatsApp alert, is for paid plans only.
  - **Payments → Payment checks** (`/payments?show=checks`, `listPaymentClaims`, `countOpenPaymentClaims`): the screenshot next to what actually arrived, with the warning signs and links to the order and chat. "Nothing arrived" comes first.
  - **Closing a check.** Owner or staff can close a check after looking into it (`dismissPaymentClaim`, event `payment.claim_dismissed`). Money received outside Fulcra is still recorded by marking the order paid.
  - **Home page** warning while any check has no money.
  - **Ask Fulcra** tool `paymentChecks`. Its note tells the AI never to call a payment fake for sure, only to say what arrived.

## Consequences

- Works only for money paid through Fulcra (payment link or dedicated account). Money paid into the seller's own account outside Fulcra is invisible to us: the owner is asked to check their bank app and can close the claim.
- No pixel-level forgery detection. We say so plainly in the product.
- A merge of two customers moves their claims too (`mergeCustomerIntoInTx`).
