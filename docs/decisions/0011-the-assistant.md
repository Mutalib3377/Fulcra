# 0011 — The assistant: turns, tools and the price guard

Status: accepted (A2a)

## Context

The assistant answers customers, takes orders and sends payment details. Rule 10 says it never touches the database and never states a price, stock level or payment status that did not come from the database. Customers often send several short messages in a row, chats can be taken over by a person at any moment, and model calls cost money (rule 12).

## Decision

- **One job per inbound message, newest wins.** `receiveInboundMessage` routes to the assistant; the worker queues `agent-reply` with a short delay (`AGENT_REPLY_DELAY_SECONDS`, 4 s) and the message id as singleton key. When it runs, `claimAgentTurn` only returns a turn if that message is still the newest inbound one, so a burst of messages gets one reply that sees all of them, and no message is missed. Before queuing the reply, `queueAgentReply` checks again (no newer message, chat not taken over).
- **Core owns the tools.** `packages/core/src/agent` has `assistant*` service functions (search, product, stock with wholesale prices, alternatives, delivery fee, create order, payment link, account details, order and payment status, tag customer, hand off). They act as `AssistantActor` (`{ businessId, assistant: true }`), a `Performer` accepted by `authorize` next to user actors; events record `{ type: 'agent' }`. Every tool first checks that the assistant is on, handling the chat, the chat is open and the reply window is open. Order tools only work for the conversation's own customer.
- **`packages/agent`** builds the prompt (stable system prompt from brand kit, settings and catalog outline, cached; a per-turn note with the time, open/closed and the customer), defines strict tool schemas, validates tool input with Zod and runs the loop (`runAgentTurn`, at most 8 rounds). Every tool call is saved to `agent_actions`; every model call to `usage_records` (`agent.reply`).
- **History is plain text from the database** each turn (last 30 messages); only the current turn's tool loop is sent back unchanged. Simple, survives restarts and handoffs, and keeps the cached prefix stable.
- **Price guard.** After the model answers, every Naira amount in the reply (`amountsInText`) must appear in a tool result from this turn or in earlier replies built from them (`amountsInData`). Otherwise (`unverifiedAmounts`) the reply is not sent, the check is logged and the chat is handed off with "The assistant was unsure about a price". Refusals, cut-off answers, tool errors that cannot be explained and a missing API key also hand off.
- **Hours.** Outside business hours the assistant keeps selling if `agent_settings.after_hours_orders` is on (new column); otherwise it sends the away message once per 12 hours and marks the chat for the team.
- **Model.** `claude-opus-5-5` at low effort, with server-side fallback. A cheaper model for simple turns is decided in A2b after measuring cost and quality.

## Consequences

- A2b adds photos (Claude describes the image, then the catalog is searched), more scenarios and the model measurement.
- A3 only needs the WhatsApp adapter: the assistant already replies through the standard outbound queue.
- The price guard can block an honest reply that repeats an amount the customer typed; that ends in a handoff, which is the safe side.
