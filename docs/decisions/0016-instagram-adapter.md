# 0016 — The Instagram adapter

Status: accepted (G1)

## Context

Many sellers sell mostly through Instagram DMs. The stack uses the Instagram API with Instagram Login (no Facebook Page needed). Its tokens last 60 days; Instagram has no message templates, so nothing can be sent more than 24 hours after the customer's last message. Messaging is free.

## Decision

- **"Connect Instagram"** is an OAuth redirect from Settings → Instagram (owner only). A signed, ten-minute state (`createSignedState`, now in Core for any login flow) plus a nonce cookie tie the callback to the person who started it. The code becomes a short-lived token and then a 60-day token; we read the professional account id (`user_id`, what webhooks name), subscribe our app to `messages`, `messaging_postbacks` and `messaging_seen`, and save the connection with the token encrypted and its expiry.
- **Renewal**: a daily job renews tokens that are at least a day old and have 15 days or less left. A token that ran out, or that Instagram refuses, marks the connection "Needs attention" with a plain reason.
- **Webhook** `/api/webhooks/instagram`: same steps as WhatsApp (signature with the Instagram app secret, saved once, queued). The adapter turns DMs, quick-reply taps, postbacks and story replies into standard messages, ignores echoes of our own sends, and turns "seen" into read ticks. Photos come as temporary links (`media.url`); the worker downloads and stores them before the message is queued, so the assistant can see them. Webhooks carry no names, so the worker asks Instagram for the customer's name (best effort).
- **Sending**: text, images and quick replies (up to 13; longer lists become numbered text). Instagram's error codes map to retry, give up (24-hour window) or reconnect.
- **24-hour rule**: Core's reply window already covers Instagram. The inbox says plainly that nothing can be sent after 24 hours (no templates are offered). Automatic receipts and order updates go to Instagram customers only while their chat is open; WhatsApp is preferred when a customer has both.
- **No schema change**: `channel_connections.expires_at` already existed.

## Consequences

- Real use needs the owner's Instagram app keys and, for other sellers' accounts, App Review for Advanced Access to `instagram_business_manage_messages` (a screen recording of the flow).
- Messages the seller sends from the Instagram app itself are not shown in the inbox yet (echoes are ignored).
- Asking Instagram for the name on every message is cheap but could be cached later.
