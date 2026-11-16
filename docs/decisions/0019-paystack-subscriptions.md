# 0019 — Paying for plans with Paystack subscriptions

Status: accepted (B1b)

## Context

B1a gave every business a plan, a trial and limits (`docs/decisions/0018`). Sellers now need to pay for a plan, renew automatically, and change or stop it. Paystack (already used for sellers' customers) offers plans and subscriptions that charge a saved card. Its webhooks for one payment can arrive in any order.

## Decision

- **Plans at Paystack come from code.** The `sync-billing-plans` job (run when the worker starts, if a Paystack key is set) copies `PLANS` into the `plans` table and creates any missing plan at Paystack, monthly and yearly. A price change clears the stored Paystack code so a new plan is made; existing subscribers stay on what they paid until they change plan.
- **Checkout** is a normal Paystack transaction with the plan code and metadata `kind: 'fulcra_subscription'`. No subaccount: subscription money is Fulcra's, unlike sellers' sales (`docs/decisions/0001`). Only the owner can pay or change the plan.
- **Paystack is the source of truth for money.** `charge.success` is verified with Paystack (success, NGN, amount at least the plan price; otherwise "needs review"), recorded once in `subscription_payments` by reference, and moves the paid period to payment date + month or year. Renewals arrive the same way.
- **Failed renewal** (`invoice.payment_failed`) sets `past_due` with 7 days of grace; the plan keeps working until the grace ends.
- **Upgrade** happens now: a new checkout for the bigger plan; once paid, the old subscription is disabled at Paystack.
- **Downgrade** happens at renewal: the current subscription is disabled and the smaller plan is scheduled on the saved card with `start_date` = end of the paid period (`pendingPlanCode` until its first payment).
- **Cancel** disables the subscription; the plan works until the end of the paid period (`effectiveStatus` already handles this).
- **Webhook order.** `subscription.create` can arrive before the `charge.success` that it belongs to. If we cannot yet tie it to a business, or it names a plan we are not on or switching to, the handler throws `SubscriptionNotLinkedYet` and the job retries. Events about a subscription that is no longer the business's current one are ignored.

## Consequences

- No card data or extra provider: Paystack holds the card; we store only the subscription, customer and authorization codes.
- Real test-mode runs need the owner's Paystack test key and the webhook URL set in the dashboard.
- Proration on upgrade is not done: the new plan starts a fresh period from its payment.
