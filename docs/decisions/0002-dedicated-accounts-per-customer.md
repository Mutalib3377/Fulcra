# 0002 — Dedicated virtual account per customer, not per business

Status: accepted

## Context

The plan said "a dedicated account per business" and matched transfers by amount, customer and recency. In Paystack a dedicated virtual account (DVA) belongs to one Paystack **customer**. One shared account per business would also make matching unreliable: many customers pay the same amounts, and the sender's name on a transfer often differs from the customer's name.

## Decision

- Each customer of a business gets their own DVA, linked to that business's subaccount (see 0001). It is created the first time we need to send them account details, and saved on the customer.
- An incoming transfer tells us exactly which customer paid. We match it to that customer's open orders: exact amount first, then the oldest unpaid order.
- Anything that does not match (wrong amount, no open order) creates `payment.unmatched` and appears in the "Unmatched payments" list for manual assignment.
- If DVA is not available (not yet approved by Paystack, or a customer fails validation), the agent sends a payment link, which also supports bank transfer.

## Consequences

- Customers need a name and phone number before we create their account; the agent collects these during ordering anyway.
- Paystack must approve DVA for our account (owner task in Week 0). Check whether they require extra customer validation for our use case.
