import { formatNaira } from '@fulcra/config';
import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { enqueueSendMessage, enqueueSubmitTemplates } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { createPaymentLink } from '../payments/payments';
import { receiptUrl } from '../payments/urls';
import { decryptSecret } from '../shared/crypto';
import { CoreError } from '../shared/errors';
import { findOrOpenConversation } from './conversations';
import { messagePreview, replyWindow } from './rules';

/**
 * WhatsApp message templates and the automatic customer messages that use them (A3b, see
 * docs/decisions/0014). Templates are the only messages WhatsApp allows outside the 24-hour
 * window; Fulcra submits a starter set for each connected number and Meta approves them.
 */

const mt = schema.messageTemplates;
const cn = schema.channelConnections;
const m = schema.messages;
const c = schema.conversations;

export const TEMPLATE_PURPOSES = [
  'order_confirmation',
  'payment_receipt',
  'order_update',
  'payment_reminder',
  'reply_request',
] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

type StarterTemplate = { name: string; body: string; examples: string[]; label: string };

/**
 * The starter set, written as plain utility messages (no promotion: Meta would re-classify
 * them as marketing, which costs about six times more). Placeholders are never first or last.
 * A wording change needs a new name (Meta does not allow editing approved templates freely).
 */
export const STARTER_TEMPLATES: Record<TemplatePurpose, StarterTemplate> = {
  order_confirmation: {
    label: 'Order confirmation',
    name: 'fulcra_order_confirmation_v1',
    body: 'Hi {{1}}, thank you for your order {{2}} from {{3}}. Your total is {{4}}. We will let you know when it is on its way.',
    examples: ['Chioma', '#1024', 'Ada Styles', '₦17,000.00'],
  },
  payment_receipt: {
    label: 'Payment received',
    name: 'fulcra_payment_receipt_v1',
    body: 'Hi {{1}}, we have received your payment of {{2}} for order {{3}} from {{4}}. Your receipt: {{5}} Thank you!',
    examples: [
      'Chioma',
      '₦17,000.00',
      '#1024',
      'Ada Styles',
      'https://adastyles.yourdomain.com/receipt/abc123',
    ],
  },
  order_update: {
    label: 'Order update',
    name: 'fulcra_order_update_v1',
    body: 'Hi {{1}}, an update on your order {{2}} from {{3}}: {{4}}. Reply to this message if you have any questions.',
    examples: ['Chioma', '#1024', 'Ada Styles', 'it is on its way to you'],
  },
  payment_reminder: {
    label: 'Payment reminder',
    name: 'fulcra_payment_reminder_v1',
    body: 'Hi {{1}}, your order {{2}} from {{3}} ({{4}}) is still waiting for payment. You can pay here: {{5}} Reply to this message if you need help.',
    examples: ['Chioma', '#1024', 'Ada Styles', '₦17,000.00', 'https://paystack.com/pay/abc123'],
  },
  reply_request: {
    label: 'Ask the customer to reply',
    name: 'fulcra_reply_request_v1',
    body: 'Hi {{1}}, this is {{2}} following up on your message. Please reply to this message so we can continue our chat.',
    examples: ['Chioma', 'Ada Styles'],
  },
};

/** WhatsApp refuses newlines, tabs and long runs of spaces in template values. */
export function templateParam(value: string): string {
  const clean = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return (clean || '-').slice(0, 1000);
}

/** The template's wording with its values filled in (what the customer reads). */
export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');
}

/** Adds the starter set for a connection (missing ones only). Called when WhatsApp connects. */
export async function ensureStarterTemplatesInTx(
  tx: Tx,
  businessId: string,
  connectionId: string,
): Promise<void> {
  await tx
    .insert(mt)
    .values(
      TEMPLATE_PURPOSES.map((purpose) => ({
        businessId,
        connectionId,
        purpose,
        name: STARTER_TEMPLATES[purpose].name,
        body: STARTER_TEMPLATES[purpose].body,
      })),
    )
    .onConflictDoNothing();
}

/** The connection moved to another WhatsApp Business Account: its templates must be sent again. */
export async function resetTemplatesInTx(tx: Tx, connectionId: string): Promise<void> {
  await tx
    .update(mt)
    .set({ status: 'not_submitted', externalId: null, statusReason: null })
    .where(eq(mt.connectionId, connectionId));
}

export type TemplateView = Pick<
  schema.MessageTemplate,
  'id' | 'purpose' | 'name' | 'body' | 'status' | 'statusReason' | 'updatedAt'
> & {
  label: string;
  /** The wording filled in with sample values, for the owner to read. */
  example: string;
};

/** The business's WhatsApp templates and where each one is with Meta. */
export async function listMessageTemplates(actor: ActorContext): Promise<TemplateView[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const rows = await tx
      .select({
        id: mt.id,
        purpose: mt.purpose,
        name: mt.name,
        body: mt.body,
        status: mt.status,
        statusReason: mt.statusReason,
        updatedAt: mt.updatedAt,
      })
      .from(mt)
      .innerJoin(cn, eq(cn.id, mt.connectionId))
      .where(and(eq(cn.mode, 'live'), ne(cn.status, 'disconnected')))
      .orderBy(asc(mt.createdAt));
    const order = (p: string) => TEMPLATE_PURPOSES.indexOf(p as TemplatePurpose);
    return rows
      .sort((a, b) => order(a.purpose) - order(b.purpose))
      .map((r) => {
        const starter = STARTER_TEMPLATES[r.purpose as TemplatePurpose];
        return {
          ...r,
          label: starter?.label ?? r.name,
          example: starter ? renderTemplate(r.body, starter.examples) : r.body,
        };
      });
  });
}

// ─── Submitting to Meta (worker) ─────────────────────────────────────────────

export type TemplatesToSubmit = {
  businessAccountId: string;
  credentials: string | null;
  templates: {
    id: string;
    name: string;
    language: string;
    category: string;
    body: string;
    examples: string[];
  }[];
};

/** Worker: the connection's templates not yet sent to Meta, with what the adapter needs. */
export async function templatesToSubmit(
  businessId: string,
  connectionId: string,
): Promise<TemplatesToSubmit | null> {
  return withTenant(businessId, async (tx) => {
    const [connection] = await tx
      .select()
      .from(cn)
      .where(and(eq(cn.id, connectionId), eq(cn.mode, 'live'), eq(cn.status, 'connected')))
      .limit(1);
    if (!connection?.externalBusinessId) return null;
    const rows = await tx
      .select()
      .from(mt)
      .where(and(eq(mt.connectionId, connectionId), eq(mt.status, 'not_submitted')));
    rows.sort(
      (a, b) =>
        TEMPLATE_PURPOSES.indexOf(a.purpose as TemplatePurpose) -
        TEMPLATE_PURPOSES.indexOf(b.purpose as TemplatePurpose),
    );
    return {
      businessAccountId: connection.externalBusinessId,
      credentials: connection.credentials ? decryptSecret(connection.credentials) : null,
      templates: rows.map((r) => ({
        id: r.id,
        name: r.name,
        language: r.language,
        category: r.category,
        body: r.body,
        examples: STARTER_TEMPLATES[r.purpose as TemplatePurpose]?.examples ?? [],
      })),
    };
  });
}

/** Meta's statuses as ours. */
export function templateStatusFromMeta(status: string): schema.TemplateStatus {
  switch (status.toUpperCase()) {
    case 'APPROVED':
    case 'REINSTATED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'PAUSED':
    case 'FLAGGED':
      return 'paused';
    case 'DISABLED':
    case 'PENDING_DELETION':
    case 'DELETED':
      return 'disabled';
    default:
      return 'pending';
  }
}

/** Worker: what Meta said when the template was submitted. */
export async function saveTemplateSubmission(
  businessId: string,
  templateId: string,
  result: { externalId: string | null; status: string; reason?: string | null },
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(mt)
      .set({
        externalId: result.externalId,
        status: templateStatusFromMeta(result.status),
        statusReason: result.reason ?? null,
      })
      .where(eq(mt.id, z.uuid().parse(templateId))),
  );
}

export const templateStatusUpdate = z.object({
  businessAccountId: z.string().min(1).max(64),
  externalId: z.string().max(64).optional(),
  name: z.string().max(512).optional(),
  language: z.string().max(15).optional(),
  status: z.string().min(1).max(40),
  reason: z.string().max(500).nullable().optional(),
});

/**
 * A template status webhook (approved, rejected…). The webhook names the WhatsApp Business
 * Account, so the businesses are found with system access (docs/decisions/0003); the
 * update itself runs per business. Returns how many templates changed.
 */
export async function applyTemplateStatusUpdate(
  channel: schema.Channel,
  input: z.input<typeof templateStatusUpdate>,
): Promise<number> {
  const update = templateStatusUpdate.parse(input);
  const connections = await withSystem((tx) =>
    tx
      .select({ id: cn.id, businessId: cn.businessId })
      .from(cn)
      .where(
        and(
          eq(cn.channel, channel),
          eq(cn.externalBusinessId, update.businessAccountId),
          ne(cn.status, 'disconnected'),
        ),
      ),
  );
  const status = templateStatusFromMeta(update.status);
  const reason =
    update.reason && update.reason.toUpperCase() !== 'NONE'
      ? update.reason.replace(/_/g, ' ').toLowerCase()
      : null;
  let changed = 0;
  for (const connection of connections) {
    const match = update.externalId
      ? or(
          eq(mt.externalId, update.externalId),
          update.name ? and(eq(mt.name, update.name), isNull(mt.externalId)) : undefined,
        )
      : update.name
        ? and(eq(mt.name, update.name), eq(mt.language, update.language ?? 'en'))
        : undefined;
    if (!match) continue;
    const rows = await withTenant(connection.businessId, (tx) =>
      tx
        .update(mt)
        .set({
          status,
          statusReason: status === 'approved' ? null : reason,
          ...(update.externalId ? { externalId: update.externalId } : {}),
        })
        .where(and(eq(mt.connectionId, connection.id), match))
        .returning({ id: mt.id }),
    );
    changed += rows.length;
  }
  return changed;
}

// ─── Sending a template or a notification ────────────────────────────────────

type Chat = { conversation: schema.Conversation; connection: schema.ChannelConnection };

/** The customer's WhatsApp chat on the live number (opened if needed), or null. */
async function customerWhatsAppChat(
  tx: Tx,
  businessId: string,
  customerId: string,
): Promise<Chat | null> {
  const [connection] = await tx
    .select()
    .from(cn)
    .where(and(eq(cn.channel, 'whatsapp'), eq(cn.mode, 'live'), eq(cn.status, 'connected')))
    .limit(1);
  if (!connection) return null;
  const [identity] = await tx
    .select({ id: schema.customerIdentities.id })
    .from(schema.customerIdentities)
    .where(
      and(
        eq(schema.customerIdentities.customerId, customerId),
        eq(schema.customerIdentities.channel, 'whatsapp'),
      ),
    )
    .limit(1);
  if (!identity) return null;
  const conversation = await findOrOpenConversation(tx, businessId, connection, customerId);
  return { conversation, connection };
}

async function approvedTemplate(
  tx: Tx,
  connectionId: string,
  purpose: TemplatePurpose,
): Promise<schema.MessageTemplate | null> {
  const [row] = await tx
    .select()
    .from(mt)
    .where(
      and(eq(mt.connectionId, connectionId), eq(mt.purpose, purpose), eq(mt.status, 'approved')),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Queues a message to the customer: free-form while the 24-hour window is open, the approved
 * template otherwise. Returns null when it cannot be sent (window closed, template not
 * approved yet). `key` makes it happen once (e.g. one receipt per payment event).
 */
async function queueCustomerMessageInTx(
  tx: Tx,
  businessId: string,
  chat: Chat,
  input: {
    purpose: TemplatePurpose;
    params: string[];
    key?: string;
    sender: 'system' | 'human';
    sentByUserId?: string | null;
  },
): Promise<{ messageId: string; kind: 'text' | 'template' } | null> {
  const params = input.params.map(templateParam);
  const window = replyWindow(chat.conversation.channel, chat.conversation.lastCustomerMessageAt);
  const template = window.open
    ? null
    : await approvedTemplate(tx, chat.connection.id, input.purpose);
  if (!window.open && !template) return null;
  const body = template?.body ?? STARTER_TEMPLATES[input.purpose].body;
  const text = renderTemplate(body, params);
  const [saved] = await tx
    .insert(m)
    .values({
      businessId,
      conversationId: chat.conversation.id,
      direction: 'outbound',
      sender: input.sender,
      sentByUserId: input.sentByUserId ?? null,
      type: 'text',
      text,
      payload: {
        purpose: input.purpose,
        ...(input.key ? { notificationKey: input.key } : {}),
        ...(template
          ? { template: { name: template.name, language: template.language, params } }
          : {}),
      },
      status: 'queued',
    })
    .returning({ id: m.id });
  await tx
    .update(c)
    .set({ lastMessageAt: new Date(), lastMessagePreview: messagePreview({ type: 'text', text }) })
    .where(eq(c.id, chat.conversation.id));
  return { messageId: saved!.id, kind: template ? 'template' : 'text' };
}

// ─── Automatic customer messages (worker, every minute) ──────────────────────

/** How far back events are looked at (and retried while a template waits for approval). */
const NOTIFY_LOOKBACK_MS = 24 * 3_600_000;

/**
 * Businesses with a connected WhatsApp number (system access: the one cross-business list
 * the notifications job needs, docs/decisions/0003). Everything after runs per business.
 */
export async function businessesWithWhatsApp(): Promise<
  { businessId: string; connectedAt: Date }[]
> {
  return withSystem((tx) =>
    tx
      .select({ businessId: cn.businessId, connectedAt: cn.updatedAt })
      .from(cn)
      .where(and(eq(cn.channel, 'whatsapp'), eq(cn.mode, 'live'), eq(cn.status, 'connected'))),
  );
}

const NOTIFY_TYPES = ['order.created', 'order.paid', 'payment.confirmed', 'order.status_changed'];

/**
 * Order events from the last day that should reach a WhatsApp customer and have not yet:
 * a new order (not one the assistant just took in the chat), a payment, and an order sent
 * out or delivered. Events from before the number was connected are skipped.
 */
export async function pendingCustomerNotifications(
  businessId: string,
  connectedAt: Date,
  now = new Date(),
): Promise<string[]> {
  const since = new Date(Math.max(now.getTime() - NOTIFY_LOOKBACK_MS, connectedAt.getTime()));
  return withTenant(businessId, async (tx) => {
    // The owner can switch automatic customer messages off (Settings → Alerts).
    const [settings] = await tx
      .select({ on: schema.ownerNotificationSettings.customerMessagesEnabled })
      .from(schema.ownerNotificationSettings)
      .limit(1);
    if (settings && !settings.on) return [];
    const rows = await tx
      .select({ id: schema.events.id })
      .from(schema.events)
      .innerJoin(
        schema.customerIdentities,
        and(
          eq(schema.customerIdentities.customerId, schema.events.customerId),
          eq(schema.customerIdentities.channel, 'whatsapp'),
        ),
      )
      .where(
        and(
          eq(schema.events.businessId, businessId),
          gt(schema.events.createdAt, since),
          inArray(schema.events.type, NOTIFY_TYPES),
          sql`not (${schema.events.type} = 'order.created' and ${schema.events.actorType} = 'agent')`,
          sql`not (${schema.events.type} = 'order.status_changed' and coalesce(${schema.events.payload}->>'to', '') not in ('dispatched', 'delivered'))`,
          sql`not exists (select 1 from ${m} where ${m.businessId} = ${businessId} and ${m.direction} = 'outbound' and ${m.payload}->>'notificationKey' = 'event:' || ${schema.events.id}::text)`,
        ),
      )
      .orderBy(asc(schema.events.createdAt))
      .limit(100);
    return rows.map((r) => r.id);
  });
}

export type NotificationResult = 'queued' | 'waiting_for_template' | 'skipped';

/**
 * Sends the WhatsApp message for one order event (worker). Once per event: the chat row is
 * locked and the event's key checked again before saving.
 */
export async function sendCustomerNotification(
  businessId: string,
  eventId: string,
): Promise<NotificationResult> {
  const result = await withTenant(businessId, async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, z.uuid().parse(eventId)))
      .limit(1);
    if (!event?.orderId || !event.customerId) return { status: 'skipped' as const };
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, event.orderId))
      .limit(1);
    const [business] = await tx
      .select({ name: schema.businesses.name, subdomain: schema.businesses.subdomain })
      .from(schema.businesses)
      .limit(1);
    const [customer] = await tx
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.id, event.customerId))
      .limit(1);
    if (!order || !business || !customer) return { status: 'skipped' as const };

    const chat = await customerWhatsAppChat(tx, businessId, event.customerId);
    if (!chat) return { status: 'skipped' as const };
    await tx.select({ id: c.id }).from(c).where(eq(c.id, chat.conversation.id)).for('update');
    const key = `event:${event.id}`;
    const [done] = await tx
      .select({ id: m.id })
      .from(m)
      .where(
        and(
          eq(m.conversationId, chat.conversation.id),
          sql`${m.payload}->>'notificationKey' = ${key}`,
        ),
      )
      .limit(1);
    if (done) return { status: 'skipped' as const };

    const name = customer.name.split(' ')[0] || 'there';
    const number = `#${order.orderNumber}`;
    let purpose: TemplatePurpose;
    let params: string[];
    switch (event.type) {
      case 'order.created':
        purpose = 'order_confirmation';
        params = [name, number, business.name, formatNaira(order.total)];
        break;
      case 'order.paid':
      case 'payment.confirmed': {
        const amount = Number(event.payload.amount ?? order.total);
        purpose = 'payment_receipt';
        params = [
          name,
          formatNaira(Number.isFinite(amount) ? amount : order.total),
          number,
          business.name,
          receiptUrl(business.subdomain, order.receiptToken),
        ];
        break;
      }
      case 'order.status_changed': {
        const to = event.payload.to;
        purpose = 'order_update';
        const news =
          to === 'dispatched'
            ? 'it is on its way to you'
            : order.fulfilment === 'pickup'
              ? 'it has been collected'
              : 'it has been delivered';
        params = [name, number, business.name, news];
        break;
      }
      default:
        return { status: 'skipped' as const };
    }
    const queued = await queueCustomerMessageInTx(tx, businessId, chat, {
      purpose,
      params,
      key,
      sender: 'system',
    });
    return queued
      ? { status: 'queued' as const, messageId: queued.messageId }
      : { status: 'waiting_for_template' as const };
  });
  if (result.status === 'queued') await enqueueSendMessage(businessId, result.messageId);
  return result.status;
}

// ─── From the inbox, when the 24-hour window has closed ──────────────────────

export const INBOX_TEMPLATES = ['reply_request', 'payment_reminder'] as const;
export type InboxTemplate = (typeof INBOX_TEMPLATES)[number];

export type InboxTemplateOption = {
  purpose: InboxTemplate;
  label: string;
  preview: string;
  available: boolean;
  /** Why it can't be sent now (template waiting for Meta, no unpaid order…). */
  reason: string | null;
};

async function latestUnpaidOrder(tx: Tx, customerId: string) {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.customerId, customerId),
        inArray(schema.orders.status, ['new', 'awaiting_payment']),
      ),
    )
    .orderBy(desc(schema.orders.createdAt))
    .limit(1);
  return order ?? null;
}

/** What the team can send in a chat whose 24-hour window has closed. */
export async function inboxTemplateOptions(
  actor: ActorContext,
  conversationId: string,
): Promise<InboxTemplateOption[]> {
  const id = z.uuid().parse(conversationId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [conversation] = await tx.select().from(c).where(eq(c.id, id)).limit(1);
    if (!conversation) throw new CoreError('not_found', 'This chat no longer exists.');
    const [business] = await tx
      .select({ name: schema.businesses.name })
      .from(schema.businesses)
      .limit(1);
    const [customer] = await tx
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.id, conversation.customerId))
      .limit(1);
    const name = customer?.name.split(' ')[0] || 'there';
    const unpaid = await latestUnpaidOrder(tx, conversation.customerId);
    const options: InboxTemplateOption[] = [];
    for (const purpose of INBOX_TEMPLATES) {
      const template = await approvedTemplate(tx, conversation.connectionId, purpose);
      const params =
        purpose === 'reply_request'
          ? [name, business?.name ?? '']
          : unpaid
            ? [
                name,
                `#${unpaid.orderNumber}`,
                business?.name ?? '',
                formatNaira(unpaid.total),
                '(payment link)',
              ]
            : [];
      options.push({
        purpose,
        label: STARTER_TEMPLATES[purpose].label,
        preview: params.length ? renderTemplate(STARTER_TEMPLATES[purpose].body, params) : '',
        available: Boolean(template) && (purpose !== 'payment_reminder' || Boolean(unpaid)),
        reason: !template
          ? 'Waiting for WhatsApp to approve this message.'
          : purpose === 'payment_reminder' && !unpaid
            ? 'This customer has no unpaid order.'
            : null,
      });
    }
    return options;
  });
}

/**
 * The team sends a template in a chat whose 24-hour window has closed (owner or staff).
 * A payment reminder gets a fresh payment link for the customer's latest unpaid order.
 */
export async function sendInboxTemplate(
  actor: ActorContext,
  conversationId: string,
  purpose: InboxTemplate,
): Promise<{ messageId: string }> {
  const id = z.uuid().parse(conversationId);
  const which = z.enum(INBOX_TEMPLATES).parse(purpose);
  const unpaidOrderId = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [conversation] = await tx.select().from(c).where(eq(c.id, id)).limit(1);
    if (!conversation) throw new CoreError('not_found', 'This chat no longer exists.');
    return which === 'payment_reminder'
      ? ((await latestUnpaidOrder(tx, conversation.customerId))?.id ?? null)
      : null;
  });
  if (which === 'payment_reminder' && !unpaidOrderId)
    throw new CoreError('conflict', 'This customer has no unpaid order.');
  const link = unpaidOrderId ? await createPaymentLink(actor, unpaidOrderId) : null;

  const messageId = await withTenant(actor.businessId, async (tx) => {
    const [conversation] = await tx.select().from(c).where(eq(c.id, id)).for('update').limit(1);
    if (!conversation) throw new CoreError('not_found', 'This chat no longer exists.');
    const [connection] = await tx
      .select()
      .from(cn)
      .where(eq(cn.id, conversation.connectionId))
      .limit(1);
    if (!connection || connection.mode !== 'live' || connection.status !== 'connected')
      throw new CoreError('conflict', 'Connect your WhatsApp number to send this.');
    const template = await approvedTemplate(tx, connection.id, which);
    if (!template) throw new CoreError('conflict', 'Waiting for WhatsApp to approve this message.');
    const [business] = await tx
      .select({ name: schema.businesses.name })
      .from(schema.businesses)
      .limit(1);
    const [customer] = await tx
      .select({ name: schema.customers.name })
      .from(schema.customers)
      .where(eq(schema.customers.id, conversation.customerId))
      .limit(1);
    const name = customer?.name.split(' ')[0] || 'there';
    let params: string[];
    if (which === 'reply_request') {
      params = [name, business?.name ?? ''];
    } else {
      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, unpaidOrderId!))
        .limit(1);
      params = [
        name,
        `#${order!.orderNumber}`,
        business?.name ?? '',
        formatNaira(order!.total),
        link!.url,
      ];
    }
    // A template is allowed whatever the window; the team takes over the chat.
    const params2 = params.map(templateParam);
    const text = renderTemplate(template.body, params2);
    const [saved] = await tx
      .insert(m)
      .values({
        businessId: actor.businessId,
        conversationId: id,
        direction: 'outbound',
        sender: 'human',
        sentByUserId: actor.userId,
        type: 'text',
        text,
        payload: {
          purpose: which,
          template: { name: template.name, language: template.language, params: params2 },
        },
        status: 'queued',
      })
      .returning({ id: m.id });
    await tx
      .update(c)
      .set({
        handledBy: 'human',
        needsAttention: false,
        attentionReason: null,
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview({ type: 'text', text }),
      })
      .where(eq(c.id, id));
    return saved!.id;
  });
  await enqueueSendMessage(actor.businessId, messageId);
  return { messageId };
}

/** Queues sending the starter templates to Meta for a newly connected number. */
export async function submitStarterTemplates(
  businessId: string,
  connectionId: string,
): Promise<void> {
  await enqueueSubmitTemplates(businessId, connectionId);
}
