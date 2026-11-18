# 0023 — The owner's assistant

Status: accepted (O1a dashboard, O1b WhatsApp). Moved ahead of launch at the owner's request.

## Context

Sellers live in WhatsApp and rarely sit at a dashboard. They want to ask "how much did I sell today?" or "add this dress, ₦15k, 5 pieces" and have it done. An AI that changes stock, prices or orders must never act on a misunderstanding.

## Decision

- **Separate from the customer assistant.** Its own tables (`owner_chats`, `owner_chat_messages`), its own brain in `packages/agent` (`runOwnerTurn`, `OWNER_TOOLS`, `buildOwnerPrompt`) and its own job (`owner-message`). Two doors to the same chat logic: the dashboard ("Ask Fulcra", `/ask`) now, and Fulcra's WhatsApp number in O1b (the owner is recognised by the alert number in Settings → Alerts).
- **Owner only**, acting as the business's owner member: every tool runs through the same Core services and permissions as the dashboard (`createProduct`, `adjustStock`, `setProductPrice`, `setProductActive`, `markOrderPaid`, `updateOrderStatus`, `cancelOrder`), and changes show in the activity feed as usual.
- **Read tools** answer from data (`ownerSalesSummary`, `ownerBestSellers`, `ownerOrders`, `ownerFindOrder`, `ownerFindProducts`, low stock, chats waiting). Money reaches the AI already formatted in naira; a reply with an amount that came neither from a tool nor from the owner is not sent (same guard as the customer assistant).
- **Changes need a YES.** The AI can only *propose* (`proposeOwnerAction`): Core checks the change now (order exists, not already paid, a pickup order can't be dispatched, allowed status moves), describes it, and saves it as data on the chat with a 10-minute expiry. The owner's YES or NO (short replies, English or Pidgin: `isConfirmation` / `isRefusal`) is handled by Core **without the AI**: it takes the saved change once and runs it. Anything else replaces the waiting change.
- **Limits:** feature `owner_assistant` in every plan; fair use of 300 owner messages a month, 50 during the free trial; over the limit, a plain reply without an AI call. Every AI call is costed (`owner.assistant`).
- Voice notes come later (they need a paid speech-to-text service).

- **WhatsApp door (O1b).** Messages to Fulcra's own number used to be ignored; now `receiveOwnerWhatsAppMessage` finds the business by the sender's number (the owner's alert number, a cross-business lookup listed in `docs/decisions/0003`). A number linked to several businesses talks to the one used last, is told so once, and can write "switch to <name>" (handled without the AI). Photos are downloaded with Fulcra's credentials and stored for that business; a photo's caption is its text; voice notes get a polite "please type it". Replies are saved, then sent by the `owner-whatsapp-send` job from Fulcra's number (retried until the reply is committed). Because the owner writes first, replies are inside WhatsApp's free 24-hour service window. Unknown numbers get one short explanation a day (`consumeRateLimit`). The WhatsApp chat and the dashboard chat are separate histories.

## Consequences

- New Core service `setProductPrice` (price only, with the form's rules) so chat changes don't need the whole product form.
- The dashboard door works before Meta approves Fulcra's number, so design partners can use it now.
