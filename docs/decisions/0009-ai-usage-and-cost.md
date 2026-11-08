# 0009 — Logging AI usage and cost

Status: accepted (I1c; used by the agent in A2 and plans in B1)

## Context

Rule 12: the cost of every AI call (and later every WhatsApp conversation) is logged against the business that caused it. We need it to watch our margins, set plan limits (B1) and spot a business that costs more than it pays. The first AI feature is website import (I1c), earlier than the agent (A2) where `usage_records` was planned.

## Decision

- `usage_records` (per business, RLS): kind (`ai_call` now, `whatsapp_conversation` later), feature (e.g. `catalog_import.url`, later `agent.reply`), model, input and output tokens, quantity and cost in US dollars (`numeric(12,6)`).
- Code that calls a model reports the response's model and token counts to `recordAiUsage(businessId, …)` right after the call. Core computes the cost from a price table per model (`AI_PRICES_USD_PER_MTOK`, first-party Anthropic prices per million tokens, including cache reads and writes). An unknown model is costed at the most expensive known rate, so costs are never under-counted. Update the table when prices change.
- The model is chosen per feature in code (website import: `claude-opus-5-5` at low effort, with server-side refusal fallback on). Changing a model is a code change, so its cost change is visible in review.

## Consequences

- The cost logged for a call that fell back to another model uses the served model's price (the response's `model`); good enough for monitoring, not an invoice.
- B1 will read `usage_records` for plan limits and the billing page.
