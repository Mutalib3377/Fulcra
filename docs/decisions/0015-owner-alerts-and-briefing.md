# 0015 — Owner alerts and the daily briefing

Status: accepted (A4)

## Context

Owners need to know, on their phone, when an order is paid, stock runs low, money arrives that Fulcra could not match, or the assistant passes a chat to them; and they want one short summary each morning. Most owners' WhatsApp windows with any business number are closed, so these are template messages, which cost money (about ₦15 each in Nigeria). The seller's own connected number cannot message the owner sensibly (it would make the owner a "customer" of their own shop).

## Decision

- **Alerts come from Fulcra's own WhatsApp number**, configured with `FULCRA_WHATSAPP_PHONE_NUMBER_ID`, `FULCRA_WHATSAPP_BUSINESS_ACCOUNT_ID` and `FULCRA_WHATSAPP_ACCESS_TOKEN` (Meta's test number works in development). Its utility templates live in `platform_templates` (Fulcra-wide, system access only); they are added at worker start, sent to Meta by `submit-platform-templates`, and approved through the same WhatsApp webhook.
- **Settings per business** (`owner_notification_settings`): the owner's own number, four alert switches, briefing on/off and time (local time, default 08:00), and the switch for automatic customer messages (A3b). All on by default; alerts need the number. Saving the number counts as the owner asking for these messages.
- **Alerts from events, once each.** The `owner-alerts` job runs every minute: for each business with a number it looks at the last day's events since alerts were set up (`order.paid` / `payment.confirmed`, `stock.low`, `payment.unmatched` / `payment.needs_review`, and `conversation.handoff` by the assistant, not the team taking over) and writes `owner_alerts` rows with a unique key per event. The briefing has a key per local day and covers yesterday's paid orders plus what is waiting now (unpaid orders, orders to send out, products low on stock, chats waiting).
- **Sending** uses the approved template; alerts wait while templates are pending and are given up after a day with a reason. Without Fulcra's number they are kept as "not sent" with the reason, so the owner still sees them on the Alerts page. Delivery updates for Fulcra's number update the alert (ticks) and log its cost against the business it was for (`owner_alert.<category>`, once per message, rule 12).
- **Payment options**: `agent_settings.payment_options` (link, transfer, or both; at least one). The assistant's instructions mention only the allowed ones, and the Core tools refuse the other.

## Consequences

- Fulcra pays Meta for alerts; usage records show what each business costs, for plan limits in B1.
- Busy sellers can get many alerts; each type can be switched off. Batching alerts could come later.
- Replies from owners to Fulcra's number are ignored for now.
