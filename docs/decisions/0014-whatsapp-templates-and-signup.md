# 0014 — WhatsApp templates, automatic customer messages and Embedded Signup

Status: accepted (A3b)

## Context

Outside the 24-hour window WhatsApp only delivers templates that Meta has approved. Customers expect a confirmation and a receipt even when they last wrote days ago, and the team needs a way to restart a closed chat. Sellers cannot be asked to paste IDs and tokens from a developer dashboard. Rule 7 says other parts react to events through jobs; rule 9 says nothing is sent twice.

## Decision

- **A starter set of utility templates per number** (`STARTER_TEMPLATES`): order confirmation, payment received (with the receipt link), order update (sent out / delivered / collected), payment reminder (with a fresh payment link) and "please reply". Plain utility wording, no promotion (marketing costs about six times more), placeholders never first or last, English. They are saved in `message_templates` when WhatsApp connects and sent to Meta by the `submit-templates` job; a name that already exists in the account is looked up instead. Meta's decisions arrive on the WhatsApp webhook (`message_template_status_update`) and update the status, with Meta's reason when rejected. Connecting a number from another WhatsApp Business Account resets them.
- **Automatic customer messages from events.** A job runs every minute. For each business with a connected number, it looks at the last 24 hours of `order.created` (not orders the assistant took in the chat), `order.paid` / `payment.confirmed` and `order.status_changed` to dispatched or delivered, for customers who have written on WhatsApp, since the number was connected. Each event is messaged once: the chat row is locked and the event's key (`payload.notificationKey`) checked before saving. While the chat is open the message goes free-form (no approval needed; same price since October 2026); otherwise the approved template. If the template is not approved yet, the event is tried again until it is, for up to 24 hours. This catches every way an order is paid (Paystack, transfers, manual) without touching each code path.
- **Templates from the inbox.** When the window has closed, the chat shows the templates the team can send instead of the reply box; sending one hands the chat to the team.
- **Templates are ordinary outbound messages** with `payload.template` (name, language, values) and the filled-in text for the inbox; the adapter sends them as WhatsApp templates. Delivery, ticks and costs work as for other messages (0013).
- **"Connect WhatsApp" (Embedded Signup).** Facebook's script is loaded only when the button is used. The popup returns a code and, by a window message from facebook.com, the chosen number and account. The server exchanges the code for the seller's business token, registers the number with a random six-digit PIN (kept encrypted with the token), subscribes our app and saves the connection. Connecting with Meta details stays available under "Advanced" (and for Meta's test number).

## Consequences

- Owners see each template's status in Settings → WhatsApp. Messages wait while templates are pending.
- Automatic messages can arrive up to about a minute after the event.
- The button only works for other people's numbers after Meta Business Verification and App Review (Tech Provider), and needs `META_APP_ID` and `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`.
- A4 adds owner alerts and briefings from a Fulcra number, and per-business switches for automatic messages.
