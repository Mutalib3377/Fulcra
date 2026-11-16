# 0018 — Plans, entitlements and conversation limits

Status: accepted (B1a)

## Context

Rule 6 asks every module and channel action to check `canUse`, and usage-based features to respect plan limits. Our main cost per seller is the AI (WhatsApp fees are billed to the seller's own WhatsApp account when connected through Embedded Signup), so limits are counted in assistant conversations. Prices and limits are still being tested with sellers.

## Decision

- **Plans in code** (`PLANS` in `billing/rules.ts`): Starter (₦12,500 a month, 150 chats, one channel), Growth (₦25,000, 500 chats, all channels, alerts, shop imports), Pro (₦50,000, 1,500 chats). Annual = 10 months. The `plans` table keeps prices charged and Paystack plan codes (B1b). Changing a price or limit is one edit.
- **Every business starts a 14-day trial of Growth** (`subscriptions` row created with the business; existing businesses got one when billing went live).
- **Status from dates** (`effectiveStatus`): a trial or paid period that ran out has ended; a renewal that didn't arrive gives 7 days of grace; cancelled plans run to the end of the paid period. No job is needed to expire anything.
- **`canUse` is real**: plan (or trial) features, then per-business `entitlements` switches set by Fulcra, then — for channels — how many the plan allows at once (Starter: the first channel connected; disconnect it to switch). Checked in channel connections, the assistant, alerts, automatic customer messages and shop imports, with plain "part of Growth" / "plan has ended" messages; dashboard pages show them instead of a connect button.
- **Without a plan, sales never stop**: the store, payments, catalog, orders and inbox keep working; the assistant, alerts and automatic customer messages pause (our costs).
- **Conversation limits**: before replying, the assistant claims the chat for the month (`claimAgentConversation`, one usage record per chat per month, an advisory lock per business so two chats can't take the last one). Over the limit, the chat goes to the team with the reason. Crossing 80% and 100% writes one `usage.limit` event a month each: a dashboard banner and, with alerts on, a WhatsApp alert. The month is the calendar month in the business's time zone.
- **Staff seat limits** are not enforced yet (to come with paid extra seats).

## Consequences

- B1b adds Paystack subscriptions (checkout, renewals, upgrade, downgrade, cancel, invoices) on these tables.
- Limits should be checked against real AI cost (`pnpm --filter @fulcra/agent measure`) before launch.
