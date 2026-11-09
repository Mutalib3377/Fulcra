# 0010 — Conversations, standard message types and the test chat

Status: accepted (A1)

## Context

The agent must never know which platform it is on (rule 3): WhatsApp, Instagram and the website chat each need an adapter that converts platform messages to one standard shape. Core stores and sends those messages, but packages may only import Core, never the other way round (rule 4). Real WhatsApp only arrives in A3, yet the inbox and pipeline need testing now.

## Decision

- **Message shapes live in Core** (`InboundMessage`, `OutboundMessage`, Zod-validated, in `packages/core/src/conversations/message-types.ts`). `@fulcra/channels` re-exports them and defines the `ChannelAdapter` interface (verify webhook, parse webhook into standard messages and status updates, send, capabilities) plus `toPlainText` for channels without buttons. The build plan said "types in `packages/channels`"; putting them in Core keeps the import direction right without duplicating them.
- **One open conversation per customer per channel account.** Incoming messages go through the queue: the `inbound-message` job calls `receiveInboundMessage`, which finds or creates the customer (linking the channel identity; WhatsApp ids give the phone number), finds or opens the conversation, saves the message once (unique `external_id`, rule 9) and routes it: to the assistant when it is on and handling the chat, otherwise "needs attention" with a plain reason.
- **Replies are queued and sent by the worker** (`send-message` job → `claimOutboundMessage` → adapter → `markMessageSent` / `markMessageFailed`). A person replying takes over the chat. "Take over" and "Give back to assistant" switch who answers and write `conversation.handoff` events.
- **24-hour rule**: `replyWindow` (browser-safe) closes free-form replies 24 hours after the customer's last message on WhatsApp and Instagram; Core refuses the reply and the inbox explains why. Templates come with A3/A4.
- **Test chat**: a per-business connection with `mode: 'test'` that behaves like WhatsApp (including the 24-hour rule) and sends nothing. The owner writes as "Test customer"; messages go through the exact same queue and worker. It stays as a product feature: owners try their assistant before going live. Test chats are labelled in the inbox. The single "Test customer" appears in the customer list.
- **Live updates by polling** (TanStack Query: the open chat every 5 s, the list every 10 s, the badge every 30 s). Light, works on unstable connections, no extra service.

## Consequences

- A3 adds the WhatsApp adapter, the webhook route (verify → save → queue) that feeds `receiveInboundMessage`, status updates (delivered/read) and saving real connections.
- If polling becomes heavy at scale, Supabase Realtime or server-sent events can replace it without changing Core.
