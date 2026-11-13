import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, ilike, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { photoDescription, type PhotoDescription } from './photos';
import { formatNaira } from '@fulcra/config';
import { variantLabel } from '../catalog/rules';
import { messagePreview, replyWindow } from '../conversations/rules';
import { mergeCustomerIntoInTx } from '../customers/merge';
import { recordEvent } from '../events/events';
import { enqueueSendMessage } from '../jobs/queue';
import type { AssistantActor } from '../members/access';
import { createOrderInTx } from '../orders/orders';
import { ORDER_STATUS_LABELS, unitPriceFor } from '../orders/rules';
import { prepareAccountDetails } from '../payments/dedicated-accounts';
import { createPaymentLink } from '../payments/payments';
import { storeUrl } from '../payments/urls';
import { storeStockStatus } from '../storefront/rules';
import { CoreError, isCoreError } from '../shared/errors';
import { normalizePhoneNumber } from '../shared/phone';
import { describeHours, isOpen, PAYMENT_OPTIONS } from './rules';
import { AGENT_SETTINGS_DEFAULTS, type AgentSettingsView } from './settings';

/**
 * What the AI assistant may read and do, for one conversation it is handling (rule 10: the
 * agent never touches the database; every fact comes from here, every action goes through
 * Core). Every function re-checks that the chat is still the assistant's, and order tools
 * only ever see this chat's customer.
 */

const c = schema.conversations;
const p = schema.products;
const v = schema.productVariants;
const HISTORY = 30;

export type AgentTurn = {
  businessId: string;
  conversationId: string;
  channel: schema.Channel;
  business: { name: string; storeUrl: string; websiteUrl: string | null; whatsappNumber: string };
  brand: { voice: schema.BrandVoice; voiceNotes: string; description: string };
  settings: AgentSettingsView;
  open: boolean;
  hoursText: string;
  customer: { id: string; name: string; phone: string | null; tags: string[]; orderCount: number };
  deliveryAreas: { name: string; fee: number }[];
  categories: string[];
  history: {
    id: string;
    sender: schema.MessageSender;
    type: schema.MessageType;
    text: string;
    createdAt: Date;
    /** A customer's photo (our stored copy). */
    image: schema.StoredImage | null;
    /** What the photo shows, once the assistant has looked at it. */
    photo: PhotoDescription | null;
  }[];
  /** The newest customer message this turn answers (to notice newer ones). */
  lastInboundId: string;
};

async function loadAssistantChat(tx: Tx, conversationId: string) {
  const [conversation] = await tx.select().from(c).where(eq(c.id, conversationId)).limit(1);
  if (!conversation) return null;
  const [settingsRow] = await tx.select().from(schema.agentSettings).limit(1);
  const active =
    conversation.status === 'open' &&
    conversation.handledBy === 'agent' &&
    settingsRow?.enabled === true &&
    replyWindow(conversation.channel, conversation.lastCustomerMessageAt).open;
  return { conversation, settingsRow, active };
}

async function requireAssistantChat(tx: Tx, conversationId: string) {
  const chat = await loadAssistantChat(tx, conversationId);
  if (!chat?.active) throw new CoreError('conflict', 'The team is handling this chat now.');
  return chat.conversation;
}

/** The owner chose which ways to pay the assistant may offer. */
async function requirePaymentOption(tx: Tx, option: 'link' | 'transfer') {
  const [row] = await tx
    .select({ options: schema.agentSettings.paymentOptions })
    .from(schema.agentSettings)
    .limit(1);
  const options = row?.options ?? ['link', 'transfer'];
  if (!options.includes(option))
    throw new CoreError(
      'conflict',
      option === 'link'
        ? 'This business does not take payment links. Offer bank transfer instead.'
        : 'This business does not take bank transfers. Offer a payment link instead.',
    );
}

/**
 * Worker: everything the assistant needs to answer, or null when it should not answer
 * (assistant off, chat taken over, closed, 24-hour window shut, nothing new to answer, or a
 * newer customer message whose own job will answer).
 */
export async function claimAgentTurn(
  businessId: string,
  conversationId: string,
  triggerMessageId?: string,
): Promise<AgentTurn | null> {
  return withTenant(businessId, async (tx) => {
    const chat = await loadAssistantChat(tx, conversationId);
    if (!chat?.active) return null;
    const { conversation, settingsRow } = chat;
    const recent = (
      await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(HISTORY)
    ).reverse();
    const last = recent.at(-1);
    if (!last || last.direction !== 'inbound') return null; // already answered
    // A newer customer message has its own job, which answers everything at once.
    if (triggerMessageId && last.id !== triggerMessageId) return null;
    const [business] = await tx.select().from(schema.businesses).limit(1);
    const [kit] = await tx.select().from(schema.brandKits).limit(1);
    const [customer] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, conversation.customerId))
      .limit(1);
    const [orders] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, conversation.customerId));
    const zones = await tx
      .select({ name: schema.deliveryZones.name, fee: schema.deliveryZones.fee })
      .from(schema.deliveryZones)
      .where(isNull(schema.deliveryZones.archivedAt))
      .orderBy(asc(schema.deliveryZones.name));
    const categories = await tx
      .selectDistinct({ category: p.category })
      .from(p)
      .where(and(eq(p.isActive, true), isNull(p.archivedAt)))
      .orderBy(asc(p.category));
    const settings: AgentSettingsView = settingsRow
      ? {
          enabled: settingsRow.enabled,
          greeting: settingsRow.greeting,
          awayMessage: settingsRow.awayMessage,
          businessHours: settingsRow.businessHours ?? null,
          afterHoursOrders: settingsRow.afterHoursOrders,
          policies: settingsRow.policies,
          handoffTopics: settingsRow.handoffTopics,
          paymentOptions: PAYMENT_OPTIONS.filter((o) => settingsRow.paymentOptions.includes(o)),
        }
      : AGENT_SETTINGS_DEFAULTS;
    return {
      businessId,
      conversationId,
      channel: conversation.channel,
      business: {
        name: business!.name,
        storeUrl: storeUrl(business!.subdomain),
        websiteUrl: business!.hasExternalWebsite ? business!.websiteUrl : null,
        whatsappNumber: business!.whatsappNumber,
      },
      brand: {
        voice: kit?.voice ?? 'friendly',
        voiceNotes: kit?.voiceNotes ?? '',
        description: kit?.description ?? '',
      },
      settings,
      open: isOpen(settings.businessHours, new Date(), business!.timezone),
      hoursText: describeHours(settings.businessHours),
      customer: {
        id: customer!.id,
        name: customer!.name,
        phone: customer!.phone,
        tags: customer!.tags,
        orderCount: orders?.n ?? 0,
      },
      deliveryAreas: zones,
      categories: categories.map((r) => r.category).filter((x): x is string => Boolean(x)),
      history: recent.map((m) => {
        const photo = photoDescription.safeParse(m.payload.photo);
        return {
          id: m.id,
          sender: m.sender,
          type: m.type,
          text: m.text,
          createdAt: m.createdAt,
          image: m.media?.image ?? null,
          photo: photo.success ? photo.data : null,
        };
      }),
      lastInboundId: last.id,
    };
  });
}

// ─── Catalog tools ───────────────────────────────────────────────────────────

const naira = (kobo: number) => formatNaira(kobo);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'for',
  'with',
  'of',
  'in',
  'on',
  'do',
  'you',
  'have',
  'any',
  'this',
  'that',
  'is',
  'it',
  'please',
  'abeg',
]);

/** Search words: lowercase, no filler words, simple plurals ("gowns" finds "gown"). */
export function searchWords(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  return [...new Set(words)].slice(0, 8);
}

export const searchProductsInput = z.object({
  query: z.string().trim().max(100),
  category: z.string().trim().max(60).nullable().default(null),
});

/** Active products matching words in the name, description or category (up to 8). */
export async function assistantSearchProducts(
  businessId: string,
  conversationId: string,
  input: z.input<typeof searchProductsInput>,
) {
  const { query, category } = searchProductsInput.parse(input);
  return withTenant(businessId, async (tx) => {
    await requireAssistantChat(tx, conversationId);
    const words = searchWords(query);
    const like = (w: string) => `%${w.replace(/[\\%_]/g, '\\$&')}%`;
    const conditions = [eq(p.isActive, true), isNull(p.archivedAt)];
    if (category) conditions.push(ilike(p.category, category));
    // Best matches first: two points per search word in the name, one in the description,
    // category or an option's colour (photo searches send several words).
    const score = words.length
      ? sql<number>`(${sql.join(
          words.map(
            (w) =>
              sql`(case when bool_or(${p.name} ilike ${like(w)}) then 2 when bool_or(${p.description} ilike ${like(w)} or coalesce(${p.category}, '') ilike ${like(w)} or coalesce(${v.colour}, '') ilike ${like(w)}) then 1 else 0 end)`,
          ),
          sql` + `,
        )})::int`
      : sql<number>`0`;
    const rows = await tx
      .select({
        productId: p.id,
        name: p.name,
        category: p.category,
        minPrice: sql<number>`min(coalesce(${v.priceOverride}, ${p.retailPrice}))::int`,
        maxPrice: sql<number>`max(coalesce(${v.priceOverride}, ${p.retailPrice}))::int`,
        stock: sql<number>`coalesce(sum(${v.stock}), 0)::int`,
        hasOptions: sql<boolean>`bool_or(not ${v.isDefault})`,
        wholesalePrice: p.wholesalePrice,
        wholesaleMinQty: p.wholesaleMinQty,
      })
      .from(p)
      .innerJoin(v, and(eq(v.productId, p.id), isNull(v.archivedAt)))
      .where(and(...conditions))
      .groupBy(p.id)
      .having(words.length ? sql`${score} > 0` : undefined)
      .orderBy(desc(score), desc(p.updatedAt))
      .limit(8);
    return {
      products: rows.map((r) => ({
        productId: r.productId,
        name: r.name,
        category: r.category,
        price: r.minPrice === r.maxPrice ? naira(r.minPrice) : `from ${naira(r.minPrice)}`,
        inStock: r.stock > 0,
        hasSizesOrColours: r.hasOptions,
        wholesale:
          r.wholesalePrice !== null
            ? `${naira(r.wholesalePrice)} each for ${r.wholesaleMinQty} or more`
            : null,
      })),
    };
  });
}

/** One product with each option's price and stock status. */
export async function assistantGetProduct(
  businessId: string,
  conversationId: string,
  productId: string,
) {
  const id = z.uuid().safeParse(productId);
  if (!id.success) throw new CoreError('validation', 'Unknown product.');
  return withTenant(businessId, async (tx) => {
    await requireAssistantChat(tx, conversationId);
    const [product] = await tx
      .select()
      .from(p)
      .where(and(eq(p.id, id.data), eq(p.isActive, true), isNull(p.archivedAt)))
      .limit(1);
    if (!product) throw new CoreError('not_found', 'This product is not available.');
    const options = await tx
      .select()
      .from(v)
      .where(and(eq(v.productId, product.id), isNull(v.archivedAt)))
      .orderBy(asc(v.position));
    return {
      productId: product.id,
      name: product.name,
      description: product.description.slice(0, 600),
      category: product.category,
      photos: product.photos.length,
      wholesale:
        product.wholesalePrice !== null
          ? { price: naira(product.wholesalePrice), minQuantity: product.wholesaleMinQty }
          : null,
      options: options.map((o) => ({
        variantId: o.id,
        option: o.isDefault ? 'standard' : variantLabel(o),
        price: naira(o.priceOverride ?? product.retailPrice),
        stock: storeStockStatus(o.stock, product.lowStockThreshold).label,
      })),
    };
  });
}

export const checkStockInput = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(10_000),
});

/** Whether a quantity is available, and its price (wholesale applies from the minimum quantity). */
export async function assistantCheckStock(
  businessId: string,
  conversationId: string,
  input: z.input<typeof checkStockInput>,
) {
  const { variantId, quantity } = checkStockInput.parse(input);
  return withTenant(businessId, async (tx) => {
    await requireAssistantChat(tx, conversationId);
    const [row] = await tx
      .select({ variant: v, product: p })
      .from(v)
      .innerJoin(p, eq(p.id, v.productId))
      .where(
        and(eq(v.id, variantId), isNull(v.archivedAt), eq(p.isActive, true), isNull(p.archivedAt)),
      )
      .limit(1);
    if (!row) throw new CoreError('not_found', 'This option is not available.');
    const { unitPrice, isWholesale } = unitPriceFor(row.product, row.variant, quantity);
    return {
      product: row.product.name,
      option: row.variant.isDefault ? 'standard' : variantLabel(row.variant),
      quantity,
      available: row.variant.stock >= quantity,
      stock: storeStockStatus(row.variant.stock, row.product.lowStockThreshold).label,
      unitPrice: naira(unitPrice),
      total: naira(unitPrice * quantity),
      wholesalePriceApplied: isWholesale,
    };
  });
}

/** In-stock products from the same category, for when something is sold out. */
export async function assistantSuggestAlternatives(
  businessId: string,
  conversationId: string,
  productId: string,
) {
  const id = z.uuid().safeParse(productId);
  if (!id.success) throw new CoreError('validation', 'Unknown product.');
  return withTenant(businessId, async (tx) => {
    await requireAssistantChat(tx, conversationId);
    const [product] = await tx
      .select({ category: p.category })
      .from(p)
      .where(eq(p.id, id.data))
      .limit(1);
    const rows = await tx
      .select({
        productId: p.id,
        name: p.name,
        minPrice: sql<number>`min(coalesce(${v.priceOverride}, ${p.retailPrice}))::int`,
      })
      .from(p)
      .innerJoin(v, and(eq(v.productId, p.id), isNull(v.archivedAt), sql`${v.stock} > 0`))
      .where(
        and(
          eq(p.isActive, true),
          isNull(p.archivedAt),
          ne(p.id, id.data),
          product?.category ? eq(p.category, product.category) : undefined,
        ),
      )
      .groupBy(p.id)
      .limit(5);
    return {
      alternatives: rows.map((r) => ({
        productId: r.productId,
        name: r.name,
        price: `from ${naira(r.minPrice)}`,
      })),
    };
  });
}

/** Delivery areas matching the customer's area (or all areas). */
export async function assistantDeliveryFee(
  businessId: string,
  conversationId: string,
  area: string,
) {
  const query = z.string().trim().max(100).parse(area);
  return withTenant(businessId, async (tx) => {
    await requireAssistantChat(tx, conversationId);
    const zones = await tx
      .select({
        deliveryZoneId: schema.deliveryZones.id,
        name: schema.deliveryZones.name,
        fee: schema.deliveryZones.fee,
        estimatedTime: schema.deliveryZones.estimatedTime,
      })
      .from(schema.deliveryZones)
      .where(isNull(schema.deliveryZones.archivedAt))
      .orderBy(asc(schema.deliveryZones.name));
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const matches = zones.filter((z) => words.some((w) => z.name.toLowerCase().includes(w)));
    const list = (matches.length ? matches : zones).map((z) => ({ ...z, fee: naira(z.fee) }));
    return { matched: matches.length > 0, areas: list, pickupAvailable: true };
  });
}

// ─── Orders and payments ─────────────────────────────────────────────────────

export const assistantOrderInput = z.object({
  items: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(20),
  fulfilment: z.enum(['delivery', 'pickup']),
  deliveryZoneId: z.uuid().nullable().default(null),
  deliveryAddress: z.string().trim().max(300).default(''),
  /** The name to put on the order when the customer gave it. */
  customerName: z.string().trim().max(120).default(''),
});

const assistant = (businessId: string): AssistantActor => ({ businessId, assistant: true });

async function customerOrder(tx: Tx, conversation: schema.Conversation, orderNumber: number) {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.customerId, conversation.customerId),
        eq(schema.orders.orderNumber, orderNumber),
      ),
    )
    .limit(1);
  if (!order) throw new CoreError('not_found', `This customer has no order #${orderNumber}.`);
  return order;
}

/** Creates the order for this chat's customer. Prices, stock and delivery fees come from the database. */
export async function assistantCreateOrder(
  businessId: string,
  conversationId: string,
  input: z.input<typeof assistantOrderInput>,
) {
  const data = assistantOrderInput.parse(input);
  return withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    if (data.customerName) {
      await tx
        .update(schema.customers)
        .set({ name: data.customerName })
        .where(
          and(eq(schema.customers.id, conversation.customerId), eq(schema.customers.name, '')),
        );
    }
    const channel = conversation.channel === 'web' ? 'web' : conversation.channel;
    const detail = await createOrderInTx(
      tx,
      businessId,
      {
        customer: { id: conversation.customerId },
        items: data.items,
        fulfilment: data.fulfilment,
        deliveryZoneId: data.deliveryZoneId,
        deliveryAddress: data.deliveryAddress,
        channel,
        notes: 'Taken by the assistant',
      },
      { type: 'agent' },
    );
    return {
      orderNumber: detail.order.orderNumber,
      items: detail.items.map((i) => ({
        product: i.productName,
        option: i.variantLabel,
        quantity: i.quantity,
        unitPrice: naira(i.unitPrice),
        lineTotal: naira(i.lineTotal),
      })),
      subtotal: naira(detail.order.subtotal),
      delivery:
        detail.order.fulfilment === 'delivery'
          ? `${detail.order.deliveryZoneName}: ${naira(detail.order.deliveryFee)}`
          : 'pickup',
      total: naira(detail.order.total),
    };
  });
}

/** A Paystack payment link for one of this customer's unpaid orders. */
export async function assistantPaymentLink(
  businessId: string,
  conversationId: string,
  orderNumber: number,
) {
  const n = z.number().int().positive().parse(orderNumber);
  const order = await withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    await requirePaymentOption(tx, 'link');
    return customerOrder(tx, conversation, n);
  });
  const link = await createPaymentLink(assistant(businessId), order.id);
  return { orderNumber: n, total: naira(order.total), paymentLink: link.url };
}

/** The customer's own bank account for paying by transfer (with a ready message). */
export async function assistantAccountDetails(
  businessId: string,
  conversationId: string,
  orderNumber: number,
) {
  const n = z.number().int().positive().parse(orderNumber);
  const order = await withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    await requirePaymentOption(tx, 'transfer');
    return customerOrder(tx, conversation, n);
  });
  const { message, account } = await prepareAccountDetails(assistant(businessId), order.id);
  return { orderNumber: n, total: naira(order.total), ...account, messageToSend: message };
}

/** Whether an order is paid, from our records (Paystack confirms payments, never the customer). */
export async function assistantOrderStatus(
  businessId: string,
  conversationId: string,
  orderNumber: number | null,
) {
  return withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    const orders = orderNumber
      ? [await customerOrder(tx, conversation, orderNumber)]
      : await tx
          .select()
          .from(schema.orders)
          .where(eq(schema.orders.customerId, conversation.customerId))
          .orderBy(desc(schema.orders.createdAt))
          .limit(3);
    return {
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        status: ORDER_STATUS_LABELS[o.status],
        paid: ['paid', 'dispatched', 'delivered'].includes(o.status),
        total: naira(o.total),
        amountPaid: naira(o.amountPaid),
        createdAt: o.createdAt.toISOString().slice(0, 10),
      })),
    };
  });
}

/** Adds a tag to this chat's customer (e.g. "wholesale buyer"). */
export async function assistantTagCustomer(
  businessId: string,
  conversationId: string,
  tag: string,
) {
  const clean = z.string().trim().min(1).max(30).parse(tag);
  return withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    await tx
      .update(schema.customers)
      .set({
        tags: sql`(select array(select distinct unnest(${schema.customers.tags} || array[${clean}]::text[])))`,
      })
      .where(eq(schema.customers.id, conversation.customerId));
    return { tagged: clean };
  });
}

export const saveCustomerDetailsInput = z.object({
  name: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).default(''),
});

/**
 * Saves the customer's name and phone number when they give them (website and Instagram
 * chats start without them). A number that already belongs to a customer links this chat to
 * them, so their orders and WhatsApp chats stay together.
 */
export async function assistantSaveCustomerDetails(
  businessId: string,
  conversationId: string,
  input: z.input<typeof saveCustomerDetailsInput>,
) {
  const data = saveCustomerDetailsInput.parse(input);
  const phone = data.phone ? normalizePhoneNumber(data.phone) : null;
  if (data.phone && !phone)
    throw new CoreError(
      'validation',
      'That phone number does not look right. Ask for a Nigerian number like 0803 123 4567.',
    );
  return withTenant(businessId, async (tx) => {
    const conversation = await requireAssistantChat(tx, conversationId);
    let customerId = conversation.customerId;
    let linked = false;
    if (phone) {
      const [existing] = await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.phone, phone))
        .limit(1);
      if (existing && existing.id !== customerId) {
        await mergeCustomerIntoInTx(tx, businessId, customerId, existing.id, { type: 'agent' });
        customerId = existing.id;
        linked = true;
      }
    }
    const [current] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, customerId))
      .limit(1);
    const changes = {
      ...(data.name && (!current?.name || !linked) ? { name: data.name } : {}),
      ...(phone && !current?.phone ? { phone } : {}),
    };
    const [saved] = Object.keys(changes).length
      ? await tx
          .update(schema.customers)
          .set(changes)
          .where(eq(schema.customers.id, customerId))
          .returning()
      : [current];
    const [orders] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, customerId));
    return {
      saved: true,
      name: saved?.name ?? '',
      phone: saved?.phone ?? null,
      knownCustomer: linked,
      pastOrders: orders?.n ?? 0,
    };
  });
}

/** Passes the chat to the team with a reason shown in the inbox. */
export async function assistantHandOff(businessId: string, conversationId: string, reason: string) {
  const why = z.string().trim().min(1).max(200).parse(reason);
  await withTenant(businessId, async (tx) => {
    const [conversation] = await tx
      .select()
      .from(c)
      .where(eq(c.id, conversationId))
      .for('update')
      .limit(1);
    if (!conversation) return;
    await tx
      .update(c)
      .set({ handledBy: 'human', needsAttention: true, attentionReason: why.slice(0, 120) })
      .where(eq(c.id, conversationId));
    await recordEvent(tx, businessId, {
      type: 'conversation.handoff',
      actor: { type: 'agent' },
      customerId: conversation.customerId,
      payload: { conversationId, to: 'human', reason: why },
    });
  });
  return { handedOff: true };
}

/** Audit trail entry for one tool call (rule 10). */
export async function recordAgentAction(
  businessId: string,
  conversationId: string,
  action: { tool: string; input: unknown; output: unknown; ok: boolean; messageId?: string | null },
): Promise<void> {
  const asRecord = (x: unknown): Record<string, unknown> =>
    x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : { value: x };
  await withTenant(businessId, (tx) =>
    tx.insert(schema.agentActions).values({
      businessId,
      conversationId,
      messageId: action.messageId ?? null,
      tool: action.tool,
      input: asRecord(action.input),
      output: asRecord(action.output),
      ok: action.ok,
    }),
  );
}

/** Amounts already said in this chat (by the team or checked assistant replies). */
export async function priorReplyTexts(
  businessId: string,
  conversationId: string,
): Promise<string[]> {
  return withTenant(businessId, async (tx) =>
    (
      await tx
        .select({ text: schema.messages.text })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.direction, 'outbound'),
          ),
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(50)
    ).map((r) => r.text),
  );
}

/**
 * Queues the assistant's reply (sent by the worker). Not sent if the team took over or a
 * newer customer message arrived meanwhile (the next turn answers both).
 */
export async function queueAgentReply(
  businessId: string,
  conversationId: string,
  text: string,
  options: { answeringInboundId?: string } = {},
): Promise<{ status: 'queued'; messageId: string } | { status: 'skipped'; reason: string }> {
  const body = z.string().trim().min(1).max(4096).parse(text);
  const result = await withTenant(businessId, async (tx) => {
    const chat = await loadAssistantChat(tx, conversationId);
    if (!chat?.active)
      return { status: 'skipped', reason: 'not handled by the assistant' } as const;
    if (options.answeringInboundId) {
      const [latest] = await tx
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.direction, 'inbound'),
          ),
        )
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(1);
      if (latest && latest.id !== options.answeringInboundId) {
        return { status: 'skipped', reason: 'a newer customer message arrived' } as const;
      }
    }
    const [message] = await tx
      .insert(schema.messages)
      .values({
        businessId,
        conversationId,
        direction: 'outbound',
        sender: 'agent',
        type: 'text',
        text: body,
        status: 'queued',
      })
      .returning({ id: schema.messages.id });
    await tx
      .update(c)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview({ type: 'text', text: body }),
        unreadCount: 0,
      })
      .where(eq(c.id, conversationId));
    return { status: 'queued', messageId: message!.id } as const;
  });
  if (result.status === 'queued') await enqueueSendMessage(businessId, result.messageId);
  return result;
}

/** Turns a Core error into a short message for the assistant (it never sees stack traces). */
export function toolErrorMessage(error: unknown): string {
  if (isCoreError(error)) return error.message;
  if (error instanceof z.ZodError)
    return `Invalid input: ${error.issues[0]?.message ?? 'check the values'}`;
  return 'Something went wrong with this tool.';
}
