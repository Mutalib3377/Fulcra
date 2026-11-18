import Anthropic from '@anthropic-ai/sdk';
import { formatNaira } from '@fulcra/config';
import {
  amountsInData,
  amountsInText,
  claimOwnerTurn,
  countConversationsNeedingAttention,
  listLowStock,
  ownerBestSellers,
  ownerFindOrder,
  ownerFindProducts,
  ownerOrders,
  ownerOrdersInput,
  ownerSalesSummary,
  proposeOwnerAction,
  recordAiUsage,
  salesPeriodInput,
  saveOwnerReply,
  toolErrorMessage,
  unverifiedAmounts,
  type OwnerActionKind,
  type OwnerTurn,
  listPaymentClaims,
} from '@fulcra/core';
import { CLAIM_FLAG_LABELS, CLAIM_STATUS_LABELS, SALES_PERIODS } from '@fulcra/core/rules';
import { z } from 'zod';
import { AGENT_MODEL, withFallback } from './models';

/**
 * The owner's assistant (O1): answers the business owner's questions about their shop and
 * prepares changes for their YES. Like the customer assistant, every fact comes from Core and
 * every AI call is costed; unlike it, nothing changes until the owner confirms (Core runs the
 * confirmed change, not the AI).
 */
const OWNER_EFFORT = 'low' as const;
const MAX_ROUNDS = 6;

type Json = Record<string, unknown>;
const object = (properties: Record<string, Json>): Anthropic.Beta.BetaTool['input_schema'] => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (description: string): Json => ({ type: 'string', description });
const int = (description: string): Json => ({ type: 'integer', description });
const bool = (description: string): Json => ({ type: 'boolean', description });
const oneOf = (values: readonly string[], description: string): Json => ({
  type: 'string',
  enum: values,
  description,
});
const nullableStr = (description: string): Json => ({ type: ['string', 'null'], description });
const tool = (
  name: string,
  description: string,
  input_schema: Anthropic.Beta.BetaTool['input_schema'],
): Anthropic.Beta.BetaTool => ({ name, description, input_schema, strict: true });

const CONFIRM_NOTE =
  'Nothing changes yet: this saves the change and returns a summary. Then ask the owner to reply YES to confirm (they can reply NO).';

export const OWNER_TOOLS: Anthropic.Beta.BetaTool[] = [
  tool(
    'salesSummary',
    'Money received from paid orders in a period, and how many orders are still unpaid now.',
    object({ period: oneOf(SALES_PERIODS, 'Which period') }),
  ),
  tool(
    'bestSellers',
    'The products sold most (by quantity) in paid orders of a period.',
    object({ period: oneOf(SALES_PERIODS, 'Which period') }),
  ),
  tool(
    'listOrders',
    'A short list of orders: unpaid (new or awaiting payment), to_send (paid, not sent yet), open (all not finished), or recent.',
    object({ which: oneOf(ownerOrdersInput.options, 'Which orders') }),
  ),
  tool(
    'findOrder',
    'One order by its number, with customer, items, total and status.',
    object({ orderNumber: int('The order number, e.g. 1042') }),
  ),
  tool(
    'findProducts',
    'Find products by words in the name or category. Returns each product with its options (variantId, stock, price). Use it before any stock, price or hide/show change.',
    object({ query: str('Words to search for, e.g. "ankara dress"') }),
  ),
  tool('lowStock', 'Products that are running low or sold out.', object({})),
  tool(
    'chatsWaiting',
    'How many customer chats are waiting for a reply from the team.',
    object({}),
  ),
  tool(
    'paymentChecks',
    'Payment checks (fake alert protection): customers who said they paid or sent a transfer screenshot, with what their screenshot says, what actually arrived, warning signs, and the status (checking, money arrived, nothing arrived, closed). Use for "any fake alerts?", "did Chioma really pay?" or "should I send this order?".',
    object({
      which: oneOf(
        ['open', 'recent'],
        'open: still checking or nothing arrived; recent: the last 7 days',
      ),
    }),
  ),
  tool(
    'proposeAddProduct',
    `Prepare a new product (one option, no sizes). ${CONFIRM_NOTE}`,
    object({
      name: str('Product name'),
      priceNaira: int('Price in naira as a whole number, e.g. 15000 for ₦15,000 or "15k"'),
      stock: int('How many are in stock'),
      description: str('Short description, or empty'),
      category: nullableStr('Category, or null'),
      usePhoto: bool('Use the photo the owner sent with this message as the product photo'),
    }),
  ),
  tool(
    'proposeSetStock',
    `Prepare setting the stock of one product option to a number. ${CONFIRM_NOTE}`,
    object({
      variantId: str('variantId from findProducts'),
      stock: int('The new stock number'),
    }),
  ),
  tool(
    'proposeSetPrice',
    `Prepare changing a product's price. ${CONFIRM_NOTE}`,
    object({
      productId: str('productId from findProducts'),
      priceNaira: int('New price in naira, whole number'),
    }),
  ),
  tool(
    'proposeShowHideProduct',
    `Prepare hiding a product from the store, or showing it again. ${CONFIRM_NOTE}`,
    object({ productId: str('productId from findProducts'), visible: bool('true to show') }),
  ),
  tool(
    'proposeMarkPaid',
    `Prepare marking an order as paid outside Fulcra. ${CONFIRM_NOTE}`,
    object({
      orderNumber: int('Order number'),
      method: oneOf(['cash', 'transfer', 'pos', 'other'], 'How the customer paid'),
    }),
  ),
  tool(
    'proposeOrderStatus',
    `Prepare marking an order as dispatched (sent) or delivered. ${CONFIRM_NOTE}`,
    object({
      orderNumber: int('Order number'),
      status: oneOf(['dispatched', 'delivered'], 'New status'),
    }),
  ),
  tool(
    'proposeCancelOrder',
    `Prepare cancelling an order (its stock goes back). ${CONFIRM_NOTE}`,
    object({ orderNumber: int('Order number'), reason: str('Reason, or empty') }),
  ),
];

const PROPOSALS: Record<string, OwnerActionKind> = {
  proposeAddProduct: 'add_product',
  proposeSetStock: 'set_stock',
  proposeSetPrice: 'set_price',
  proposeShowHideProduct: 'set_visibility',
  proposeMarkPaid: 'mark_paid',
  proposeOrderStatus: 'set_order_status',
  proposeCancelOrder: 'cancel_order',
};

/** Kobo amounts in tool results, shown as naira so the AI never converts money itself. */
const MONEY_KEYS = new Set([
  'amount',
  'unpaidAmount',
  'total',
  'amountPaid',
  'deliveryFee',
  'lineTotal',
  'retailPrice',
  'price',
  'screenshotAmount',
  'received',
  'orderTotal',
]);
function forTheAi(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(forTheAi);
  if (data instanceof Date) return data.toISOString();
  if (data && typeof data === 'object')
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [
        k,
        MONEY_KEYS.has(k) && typeof v === 'number' ? formatNaira(v) : forTheAi(v),
      ]),
    );
  return data;
}

async function runOwnerTool(turn: OwnerTurn, name: string, input: unknown): Promise<unknown> {
  const a = turn.actor;
  const kind = PROPOSALS[name];
  if (kind) return proposeOwnerAction(turn, kind, input);
  switch (name) {
    case 'salesSummary':
      return ownerSalesSummary(a, salesPeriodInput.parse((input as Json).period));
    case 'bestSellers':
      return ownerBestSellers(a, salesPeriodInput.parse((input as Json).period));
    case 'listOrders':
      return ownerOrders(a, ownerOrdersInput.parse((input as Json).which));
    case 'findOrder':
      return ownerFindOrder(
        a,
        z
          .number()
          .int()
          .parse((input as Json).orderNumber),
      );
    case 'findProducts':
      return ownerFindProducts(a, z.string().parse((input as Json).query));
    case 'lowStock':
      return (await listLowStock(a)).slice(0, 15).map((i) => ({
        product: i.productName,
        option: i.isDefault ? null : [i.size, i.colour].filter(Boolean).join(' / '),
        stock: i.stock,
      }));
    case 'chatsWaiting':
      return { waiting: await countConversationsNeedingAttention(a) };
    case 'paymentChecks': {
      const which = z.enum(['open', 'recent']).parse((input as Json).which);
      const claims = await listPaymentClaims(a, { show: which });
      return {
        note: 'A screenshot is never proof: only "money arrived" means paid. Never tell the owner a payment is fake for sure; say what arrived and the warning signs. Nothing arrived means: do not send the goods yet, and check their own bank app in case the customer paid outside Fulcra.',
        checks: claims.slice(0, 10).map((c) => ({
          customer: c.customerName,
          orderNumber: c.orderNumber,
          status: CLAIM_STATUS_LABELS[c.status],
          said: c.source === 'screenshot' ? 'sent a payment screenshot' : 'said they paid',
          screenshotAmount: c.claimedAmount,
          received: c.receivedAmount ?? 0,
          orderTotal: c.orderTotal,
          bank: c.bank,
          sender: c.senderName,
          warnings: c.flags.map((f) => CLAIM_FLAG_LABELS[f]),
          when: c.createdAt,
        })),
        total: claims.length,
      };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export function buildOwnerPrompt(turn: OwnerTurn): string {
  return `You are Fulcra, the shop assistant for the owner of ${turn.businessName}, a small business in Nigeria. You talk to the OWNER (not customers): answer their questions about sales, orders, stock and customers, and prepare changes they ask for. They may write in English, Pidgin or a mix; reply the same way.

# Rules
- Every number, name and amount comes from your tools. Never guess or calculate money yourself; use the amounts exactly as the tools give them.
- Changes (new product, stock, price, hide/show, mark paid, dispatched/delivered, cancel) are only prepared with a propose tool. After proposing, show the summary the tool returns and ask them to reply YES to confirm. Never say a change is done: it happens only after their YES.
- One change at a time. If a request is unclear (which product? which size? what price?), ask a short question first. Use findProducts to get the right product and option before stock, price or hide/show changes.
- If a propose tool refuses (for example an order already paid), explain why in plain words.
- Payment checks: a customer's screenshot or "I've paid" is never proof. Only money that arrived counts. Use paymentChecks when they ask about fake alerts or whether someone really paid; if nothing arrived, tell them not to send the goods yet.
- For things you can't do (refunds, sending messages to customers, delivery settings, payouts), say so briefly and point them to the dashboard.

# Style
Short and clear, like a helpful staff member texting the boss. Plain text, no tables. Use ₦ amounts as given.`;
}

function historyMessages(turn: OwnerTurn): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of turn.history) {
    const role = m.sender === 'owner' ? 'user' : 'assistant';
    const text = [m.image ? '[The owner sent a photo]' : '', m.text].filter(Boolean).join('\n');
    if (!text) continue;
    const prev = messages.at(-1);
    if (prev && prev.role === role && typeof prev.content === 'string')
      prev.content = `${prev.content}\n${text}`;
    else messages.push({ role, content: text });
  }
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

export type OwnerTurnResult =
  | { status: 'skipped' }
  | { status: 'replied'; messageId: string }
  | { status: 'not_sent'; reason: string };

/** Answers the newest owner message (worker job `owner-message`). */
export async function runOwnerTurn(params: {
  businessId: string;
  chatId: string;
  messageId: string;
  client: Anthropic | null;
  model?: string;
  now?: Date;
}): Promise<OwnerTurnResult> {
  const turn = await claimOwnerTurn(params.businessId, params.chatId, params.messageId);
  if (!turn) return { status: 'skipped' };
  const reply = async (text: string): Promise<OwnerTurnResult> => {
    const saved = await saveOwnerReply(turn, text);
    return saved.status === 'saved' ? { status: 'replied', messageId: saved.messageId } : saved;
  };

  if (!params.client)
    return reply(
      "I'm not switched on yet (the AI key is missing). Everything is on your dashboard in the meantime.",
    );

  const model = params.model ?? AGENT_MODEL;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: buildOwnerPrompt(turn), cache_control: { type: 'ephemeral' } },
  ];
  const now = params.now ?? new Date();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...historyMessages(turn),
    {
      role: 'system',
      content: `Now: ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: turn.timezone }).format(now)} (${turn.timezone}).${turn.hasPhoto ? ' The owner attached a photo to this message.' : ''}`,
    },
  ];
  // Amounts the reply may repeat: from tools, or said by the owner in this chat.
  const allowed = new Set<number>();
  for (const h of turn.history) amountsInText(h.text).forEach((x) => allowed.add(x));

  let text = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await params.client.beta.messages.create({
        model,
        max_tokens: 4000,
        ...withFallback(model),
        output_config: { effort: OWNER_EFFORT },
        system,
        tools: OWNER_TOOLS,
        messages,
        cache_control: { type: 'ephemeral' },
      });
    } catch (error) {
      if (
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      )
        throw error; // temporary: the job is retried
      if (error instanceof Anthropic.APIError) {
        console.error('[owner-agent] AI call failed', error.status, error.message);
        return reply("Sorry, I couldn't answer just now. Please try again in a moment.");
      }
      throw error;
    }
    await recordAiUsage(turn.businessId, {
      feature: 'owner.assistant',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens')
      return reply("Sorry, I couldn't answer that. Could you ask it another way?");

    const calls = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );
    if (calls.length === 0) {
      text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        const output = forTheAi(await runOwnerTool(turn, call.name, call.input));
        amountsInData(output, allowed);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(output),
        });
      } catch (error) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: toolErrorMessage(error),
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
    if (round === MAX_ROUNDS - 1)
      return reply('That needed too many steps. Could you ask one thing at a time?');
  }

  if (!text) return reply("Sorry, I didn't catch that. Could you say it again?");
  // The guard (rule 10): never an amount that did not come from the shop's data or the owner.
  const unverified = unverifiedAmounts(text, allowed);
  if (unverified.length > 0) {
    await reply(
      "I wasn't sure about an amount, so I didn't send my answer. Please check it on your dashboard or ask me again.",
    );
    return { status: 'not_sent', reason: `amounts not from the data: ${unverified.join(', ')}` };
  }
  return reply(text);
}
