# 0013 — The WhatsApp adapter

Status: accepted (A3a)

## Context

WhatsApp is the main channel for our sellers. Rule 3 says the agent never knows the platform; rule 8 says webhooks verify, save, queue and answer quickly; rule 9 says nothing is processed or charged twice. Real sellers can only connect their numbers through our Meta app after Business Verification and App Review, but building and testing needs neither. Since October 2026 Meta charges for every delivered message, including replies inside the 24-hour window (reported at about $0.01 per message to Nigerian numbers).

## Decision

- **One webhook for all businesses** (`/api/webhooks/whatsapp`, set once in our Meta app). GET answers Meta's verify challenge (`META_WEBHOOK_VERIFY_TOKEN`); POST checks `X-Hub-Signature-256` with `META_APP_SECRET` through the adapter, saves the raw body once in `webhook_events` (id = SHA-256 of the body, since Meta sends no event id) and queues `channel-webhook`.
- **Core stays platform-free.** Core saves webhooks, finds the business by phone number id (`findConnectionByAccount`, system access, listed in 0003), applies delivery updates and meters costs. The adapter in `@fulcra/channels` does everything WhatsApp-specific: parsing, sending (text, image, buttons, list), downloading media, read receipts with "typing…", and the error codes.
- **Worker flow.** `channel-webhook` parses the webhook, downloads and stores customer photos (so the assistant can see them), and queues each message on the existing `inbound-message` pipeline. Each delivery update is its own `message-status` job, retried a few times because "sent" can arrive before we save the id of the message we just sent.
- **Ticks only move forward** (sent → delivered → read); failures keep a plain reason (24-hour window, number without WhatsApp…).
- **Costs per delivered message.** When a delivery update says the message is billable, `recordWhatsAppUsage` logs it with Meta's category and our price table (`WHATSAPP_PRICES_USD`, Nigeria; unknown categories at the highest rate). `usage_records.reference` (the message id) is unique per kind, so two updates for one message are charged once.
- **Connecting, for now, with Meta details** (phone number ID, WhatsApp Business Account ID, access token) on Settings → WhatsApp. They are checked with Meta (`lookupWhatsAppNumber`) before saving; our app is subscribed to the account; the token is encrypted. This works with Meta's free test number. Embedded Signup replaces it for sellers in A3b.
- **Broken access is visible.** When Meta refuses the token while sending, the message fails with a reason and the connection is marked "Needs attention" so the owner reconnects.
- **No SDK**: plain `fetch` against the Graph API, version in `WHATSAPP_GRAPH_VERSION` (v26.0).

## Consequences

- A3b adds Embedded Signup (number registration, token exchange) and message templates for messages outside the 24-hour window.
- The WhatsApp price table must be kept in line with Meta's rate card; plans and prices (B1) must include WhatsApp message costs, not only AI.
- The assistant could send fewer, longer messages to save cost; replies are already one message per turn.
