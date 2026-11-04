# 0001 — Seller payouts through Paystack subaccounts

Status: accepted

## Context

Fulcra uses one Paystack account. Without anything else, every payment link and transfer would land in Fulcra's balance, so we would be holding sellers' money and paying it out ourselves. That brings settlement work, disputes and regulatory risk (acting as a payment facilitator).

## Decision

- During payment setup, each business adds its bank account. We create a **Paystack subaccount** for it and store `paystack_subaccount_code` on the business.
- Every payment link and every dedicated virtual account is created against that subaccount, so money settles straight to the seller.
- Fulcra earns from subscriptions, not from a cut of each sale (the split percentage can stay at 0% for now).

## Consequences

- Payments cannot be taken until a business has finished payout setup. Onboarding must make this step clear.
- Refunds and chargebacks follow Paystack's subaccount rules.
- Needs Paystack to enable subaccounts/splits on our account (owner task in Week 0).
