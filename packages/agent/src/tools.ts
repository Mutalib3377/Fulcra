import type Anthropic from '@anthropic-ai/sdk';
import {
  assistantAccountDetails,
  assistantCheckStock,
  assistantCreateOrder,
  assistantDeliveryFee,
  assistantGetProduct,
  assistantOrderStatus,
  assistantPaymentLink,
  assistantSearchProducts,
  assistantSuggestAlternatives,
  assistantTagCustomer,
  type AgentTurn,
} from '@fulcra/core';
import { z } from 'zod';

/** Strict JSON schema helpers: every property required, no extras (strict tool use). */
type Json = Record<string, unknown>;
const object = (properties: Record<string, Json>): Anthropic.Beta.BetaTool['input_schema'] => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const str = (description: string): Json => ({ type: 'string', description });
const nullableStr = (description: string): Json => ({ type: ['string', 'null'], description });
const int = (description: string): Json => ({ type: 'integer', description });

const tool = (
  name: string,
  description: string,
  input_schema: Anthropic.Beta.BetaTool['input_schema'],
): Anthropic.Beta.BetaTool => ({
  name,
  description,
  input_schema,
  strict: true,
});

/** The assistant's tools, in a fixed order (tool definitions are part of the cached prefix). */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  tool(
    'searchProducts',
    'Search the catalog by words (name, type, colour, category). Returns up to 8 products with price and whether in stock. Use before talking about any product.',
    object({
      query: str('Words to search for, e.g. "red ankara gown"'),
      category: nullableStr('Limit to one category, or null'),
    }),
  ),
  tool(
    'getProduct',
    'Get one product: description, options (size/colour) with their variantId, price and stock status, and the wholesale rule.',
    object({
      productId: str('productId from searchProducts'),
    }),
  ),
  tool(
    'checkStock',
    'Check if a quantity of one option is available and get the exact unit price and total for that quantity (wholesale price applies from the minimum quantity).',
    object({
      variantId: str('variantId from getProduct'),
      quantity: int('How many the customer wants'),
    }),
  ),
  tool(
    'suggestAlternatives',
    'Find similar in-stock products when something is sold out.',
    object({
      productId: str('The sold-out productId'),
    }),
  ),
  tool(
    'getDeliveryFee',
    'Find the delivery fee for the area where the customer is. Returns matching delivery areas with their deliveryZoneId and fee (or all areas when none match).',
    object({
      area: str('The area, street or town the customer mentioned'),
    }),
  ),
  tool(
    'createOrder',
    'Create the order ONLY after the customer confirmed the items, quantities, pickup or delivery (area and address) and the total. Returns the order number and exact totals.',
    object({
      items: {
        type: 'array',
        description: 'The items to order',
        items: object({ variantId: str('variantId from getProduct'), quantity: int('Quantity') }),
      },
      fulfilment: {
        type: 'string',
        enum: ['delivery', 'pickup'],
        description: 'delivery or pickup',
      },
      deliveryZoneId: nullableStr(
        'deliveryZoneId from getDeliveryFee for delivery, null for pickup',
      ),
      deliveryAddress: str('Delivery address, or "" for pickup'),
      customerName: str('The customer\'s name if they gave it, else ""'),
    }),
  ),
  tool(
    'sendPaymentLink',
    'Get a secure payment link for an unpaid order (card, bank transfer, USSD). Send the link to the customer.',
    object({
      orderNumber: int('The order number'),
    }),
  ),
  tool(
    'sendAccountDetails',
    "Get the customer's own bank account number for paying an unpaid order by transfer. Send the message it returns.",
    object({
      orderNumber: int('The order number'),
    }),
  ),
  tool(
    'checkPaymentStatus',
    'Check whether an order is paid (from the bank, never from what the customer says).',
    object({
      orderNumber: int('The order number'),
    }),
  ),
  tool(
    'getOrderStatus',
    "Get the status of the customer's orders: one by number, or their latest orders.",
    object({
      orderNumber: {
        type: ['integer', 'null'],
        description: 'The order number, or null for the latest orders',
      },
    }),
  ),
  tool(
    'tagCustomer',
    'Add a short tag to this customer for the owner, e.g. "wholesale buyer" or "Lagos Island".',
    object({
      tag: str('A short tag'),
    }),
  ),
  tool(
    'handOffToHuman',
    "Pass this chat to a person on the team. Use when the customer asks for a person, is upset, the topic is on the owner's list, or you are unsure. Then tell the customer someone will reply soon.",
    object({
      reason: str('Short reason shown to the team, e.g. "Customer wants a discount"'),
    }),
  ),
];

const orderNumber = z.object({ orderNumber: z.number().int().positive() });
const inputs = {
  searchProducts: z.object({ query: z.string(), category: z.string().nullable() }),
  getProduct: z.object({ productId: z.string() }),
  checkStock: z.object({ variantId: z.string(), quantity: z.number().int() }),
  suggestAlternatives: z.object({ productId: z.string() }),
  getDeliveryFee: z.object({ area: z.string() }),
  createOrder: z.object({
    items: z.array(z.object({ variantId: z.string(), quantity: z.number().int() })),
    fulfilment: z.enum(['delivery', 'pickup']),
    deliveryZoneId: z.string().nullable(),
    deliveryAddress: z.string(),
    customerName: z.string(),
  }),
  sendPaymentLink: orderNumber,
  sendAccountDetails: orderNumber,
  checkPaymentStatus: orderNumber,
  getOrderStatus: z.object({ orderNumber: z.number().int().positive().nullable() }),
  tagCustomer: z.object({ tag: z.string() }),
  handOffToHuman: z.object({ reason: z.string() }),
} as const;

export type ToolName = keyof typeof inputs;

/** What running a tool did. `handOff` is acted on after the reply is queued. */
export type ToolOutcome = { output: unknown; handOff?: string };

/**
 * Runs one tool call through Core. Input is validated again here (the model's arguments are
 * never trusted); Core re-checks the chat is still the assistant's and that orders belong
 * to this customer.
 */
export async function runTool(
  turn: AgentTurn,
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  if (!(name in inputs)) throw new Error(`Unknown tool ${name}`);
  const b = turn.businessId;
  const cv = turn.conversationId;
  switch (name as ToolName) {
    case 'searchProducts':
      return {
        output: await assistantSearchProducts(b, cv, inputs.searchProducts.parse(rawInput)),
      };
    case 'getProduct':
      return {
        output: await assistantGetProduct(b, cv, inputs.getProduct.parse(rawInput).productId),
      };
    case 'checkStock':
      return { output: await assistantCheckStock(b, cv, inputs.checkStock.parse(rawInput)) };
    case 'suggestAlternatives':
      return {
        output: await assistantSuggestAlternatives(
          b,
          cv,
          inputs.suggestAlternatives.parse(rawInput).productId,
        ),
      };
    case 'getDeliveryFee':
      return {
        output: await assistantDeliveryFee(b, cv, inputs.getDeliveryFee.parse(rawInput).area),
      };
    case 'createOrder':
      return { output: await assistantCreateOrder(b, cv, inputs.createOrder.parse(rawInput)) };
    case 'sendPaymentLink':
      return {
        output: await assistantPaymentLink(
          b,
          cv,
          inputs.sendPaymentLink.parse(rawInput).orderNumber,
        ),
      };
    case 'sendAccountDetails':
      return {
        output: await assistantAccountDetails(
          b,
          cv,
          inputs.sendAccountDetails.parse(rawInput).orderNumber,
        ),
      };
    case 'checkPaymentStatus':
      return {
        output: await assistantOrderStatus(
          b,
          cv,
          inputs.checkPaymentStatus.parse(rawInput).orderNumber,
        ),
      };
    case 'getOrderStatus':
      return {
        output: await assistantOrderStatus(
          b,
          cv,
          inputs.getOrderStatus.parse(rawInput).orderNumber,
        ),
      };
    case 'tagCustomer':
      return { output: await assistantTagCustomer(b, cv, inputs.tagCustomer.parse(rawInput).tag) };
    case 'handOffToHuman': {
      const { reason } = inputs.handOffToHuman.parse(rawInput);
      return {
        output: {
          ok: true,
          next: 'Tell the customer kindly that someone from the team will reply soon.',
        },
        handOff: reason,
      };
    }
  }
}
