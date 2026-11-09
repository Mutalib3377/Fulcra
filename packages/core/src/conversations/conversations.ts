import { randomUUID } from 'node:crypto';
import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { findOrCreateCustomerInTx } from '../customers/customers';
import { recordEvent, userActor } from '../events/events';
import { enqueueInboundMessage, enqueueSendMessage } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { decryptSecret } from '../shared/crypto';
import { CoreError, isUniqueViolation } from '../shared/errors';
import { normalizePhoneNumber } from '../shared/phone';
import { inboundMessage, type InboundMessageInput } from './message-types';
import { messagePreview, replyWindow, type ReplyWindow } from './rules';

/** Who may use the inbox. Riders only deliver orders. */
const INBOX = ['owner', 'staff'] as const;
const c = schema.conversations;
const m = schema.messages;
const cn = schema.channelConnections;

const TEST_CUSTOMER_ID = 'test-customer';
const testAccountId = (businessId: string) => `test:${businessId}`;

const OUTSIDE_WINDOW =
  "It's been more than 24 hours since this customer last wrote, so WhatsApp and Instagram only allow approved template messages now. Wait for them to write again.";

// ─── Incoming messages ───────────────────────────────────────────────────────

export type ReceiveResult =
  | { status: 'saved'; conversationId: string; messageId: string; route: 'agent' | 'human' }
  | { status: 'duplicate' }
  | { status: 'ignored'; reason: string };

async function findOrOpenConversation(
  tx: Tx,
  businessId: string,
  connection: schema.ChannelConnection,
  customerId: string,
): Promise<schema.Conversation> {
  const open = and(
    eq(c.connectionId, connection.id),
    eq(c.customerId, customerId),
    eq(c.status, 'open'),
  );
  const [existing] = await tx.select().from(c).where(open).for('update').limit(1);
  if (existing) return existing;
  try {
    // Savepoint: two messages from a new customer can arrive at the same moment.
    const created = await tx.transaction(async (sp) => {
      const [row] = await sp
        .insert(c)
        .values({
          businessId,
          customerId,
          connectionId: connection.id,
          channel: connection.channel,
        })
        .returning();
      return row!;
    });
    await recordEvent(tx, businessId, {
      type: 'conversation.started',
      actor: { type: 'customer', id: customerId },
      customerId,
      payload: { conversationId: created.id, channel: connection.channel },
    });
    return created;
  } catch (error) {
    if (!isUniqueViolation(error, 'conversations_open_unique')) throw error;
    const [row] = await tx.select().from(c).where(open).for('update').limit(1);
    if (!row) throw error;
    return row;
  }
}

/**
 * Worker: stores a customer's message (rule 8: after the webhook was saved and queued).
 * Finds or creates the customer and their open chat, saves the message once (rule 9) and
 * decides who answers: the assistant, or the team (marked "needs attention").
 */
export async function receiveInboundMessage(
  businessId: string,
  connectionId: string,
  input: InboundMessageInput,
): Promise<ReceiveResult> {
  const message = inboundMessage.parse(input);
  return withTenant(businessId, async (tx) => {
    const [connection] = await tx.select().from(cn).where(eq(cn.id, connectionId)).limit(1);
    if (!connection || connection.status === 'disconnected') {
      return { status: 'ignored', reason: 'connection not found or disconnected' } as const;
    }
    const [seen] = await tx
      .select({ id: m.id })
      .from(m)
      .where(eq(m.externalId, message.externalId))
      .limit(1);
    if (seen) return { status: 'duplicate' } as const;

    // WhatsApp ids are the customer's phone number in international form.
    const candidate =
      message.from.phone ??
      (connection.channel === 'whatsapp' && /^\d{8,15}$/.test(message.from.externalUserId)
        ? `+${message.from.externalUserId}`
        : null);
    const phone = candidate ? normalizePhoneNumber(candidate) : null;
    const { customer } = await findOrCreateCustomerInTx(
      tx,
      businessId,
      {
        phone,
        identity: {
          channel: connection.channel,
          externalUserId: message.from.externalUserId,
          displayName: message.from.displayName,
        },
      },
      { type: 'system' },
    );

    const conversation = await findOrOpenConversation(tx, businessId, connection, customer.id);
    const text = message.text || message.media?.caption || '';
    const [saved] = await tx
      .insert(m)
      .values({
        businessId,
        conversationId: conversation.id,
        direction: 'inbound',
        sender: 'customer',
        type: message.type,
        text,
        media: message.media ?? null,
        payload: {
          ...(message.location ? { location: message.location } : {}),
          ...(message.replyId ? { replyId: message.replyId } : {}),
          sentAt: message.sentAt.toISOString(),
        },
        externalId: message.externalId,
        status: 'received',
      })
      .returning({ id: m.id });

    const [settings] = await tx
      .select({ enabled: schema.agentSettings.enabled })
      .from(schema.agentSettings)
      .limit(1);
    const route = settings?.enabled && conversation.handledBy === 'agent' ? 'agent' : 'human';
    await tx
      .update(c)
      .set({
        lastCustomerMessageAt: sql`greatest(${c.lastCustomerMessageAt}, ${message.sentAt.toISOString()}::timestamptz)`,
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview({ type: message.type, text }),
        unreadCount: sql`${c.unreadCount} + 1`,
        ...(route === 'human'
          ? {
              needsAttention: true,
              attentionReason:
                conversation.handledBy === 'human'
                  ? 'Waiting for your reply'
                  : 'Your assistant is off',
            }
          : {}),
      })
      .where(eq(c.id, conversation.id));
    return {
      status: 'saved',
      conversationId: conversation.id,
      messageId: saved!.id,
      route,
    } as const;
  });
}

// ─── Replies ─────────────────────────────────────────────────────────────────

export const replyInput = z.object({
  text: z.string().trim().min(1, 'Type a message.').max(4096, 'This message is too long.'),
});

/**
 * A team member replies. Replying takes over the chat (the assistant stops answering it)
 * and clears "needs attention". The message is sent by the worker (rule 8).
 */
export async function sendHumanReply(
  actor: ActorContext,
  conversationId: string,
  input: z.input<typeof replyInput>,
): Promise<schema.Message> {
  const id = z.uuid().parse(conversationId);
  const { text } = replyInput.parse(input);
  const saved = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const [conversation] = await tx.select().from(c).where(eq(c.id, id)).for('update').limit(1);
    if (!conversation) throw new CoreError('not_found', 'This chat no longer exists.');
    if (!replyWindow(conversation.channel, conversation.lastCustomerMessageAt).open) {
      throw new CoreError('conflict', OUTSIDE_WINDOW);
    }
    const [message] = await tx
      .insert(m)
      .values({
        businessId: actor.businessId,
        conversationId: id,
        direction: 'outbound',
        sender: 'human',
        sentByUserId: actor.userId,
        type: 'text',
        text,
        status: 'queued',
      })
      .returning();
    await tx
      .update(c)
      .set({
        handledBy: 'human',
        needsAttention: false,
        attentionReason: null,
        unreadCount: 0,
        lastMessageAt: new Date(),
        lastMessagePreview: messagePreview({ type: 'text', text }),
      })
      .where(eq(c.id, id));
    if (conversation.handledBy !== 'human') {
      await recordEvent(tx, actor.businessId, {
        type: 'conversation.handoff',
        actor: userActor(actor),
        customerId: conversation.customerId,
        payload: { conversationId: id, to: 'human', reason: 'replied' },
      });
    }
    return message!;
  });
  try {
    await enqueueSendMessage(actor.businessId, saved.id);
  } catch (error) {
    console.error('[conversations] could not queue a reply', error);
    await markMessageFailed(actor.businessId, saved.id, 'Not sent. Please try again.');
    throw new CoreError('conflict', 'Your message was not sent. Please try again.');
  }
  return saved;
}

export type OutboundDelivery = {
  message: schema.Message;
  channel: schema.Channel;
  mode: 'live' | 'test';
  /** The platform account sending it and its decrypted secrets (live only). */
  externalAccountId: string;
  credentials: string | null;
  /** The customer on the platform. */
  to: string | null;
};

/** Worker: the queued message to send, with what the channel adapter needs. Null if already handled. */
export async function claimOutboundMessage(
  businessId: string,
  messageId: string,
): Promise<OutboundDelivery | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({ message: m, conversation: c, connection: cn })
      .from(m)
      .innerJoin(c, eq(c.id, m.conversationId))
      .innerJoin(cn, eq(cn.id, c.connectionId))
      .where(eq(m.id, messageId))
      .limit(1);
    if (!row || row.message.status !== 'queued' || row.message.direction !== 'outbound')
      return null;
    const [identity] = await tx
      .select({ externalUserId: schema.customerIdentities.externalUserId })
      .from(schema.customerIdentities)
      .where(
        and(
          eq(schema.customerIdentities.customerId, row.conversation.customerId),
          eq(schema.customerIdentities.channel, row.conversation.channel),
        ),
      )
      .limit(1);
    return {
      message: row.message,
      channel: row.connection.channel,
      mode: row.connection.mode,
      externalAccountId: row.connection.externalAccountId,
      credentials: row.connection.credentials ? decryptSecret(row.connection.credentials) : null,
      to: identity?.externalUserId ?? null,
    };
  });
}

export async function markMessageSent(
  businessId: string,
  messageId: string,
  externalId: string | null,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(m)
      .set({ status: 'sent', externalId, error: null })
      .where(and(eq(m.id, messageId), eq(m.status, 'queued'))),
  );
}

export async function markMessageFailed(
  businessId: string,
  messageId: string,
  error: string,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx.update(m).set({ status: 'failed', error }).where(eq(m.id, messageId)),
  );
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

export const inboxFilters = ['attention', 'all', 'agent', 'human'] as const;
export type InboxFilter = (typeof inboxFilters)[number];

export type ConversationListItem = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  channel: schema.Channel;
  isTest: boolean;
  handledBy: schema.ConversationHandler;
  needsAttention: boolean;
  attentionReason: string | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  unreadCount: number;
};

/** Chats, newest first. "attention" shows the ones waiting for the team. */
export async function listConversations(
  actor: ActorContext,
  filter: InboxFilter = 'all',
): Promise<ConversationListItem[]> {
  const f = z.enum(inboxFilters).parse(filter);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const conditions: SQL[] = [eq(c.status, 'open')];
    if (f === 'attention') conditions.push(eq(c.needsAttention, true));
    if (f === 'agent' || f === 'human') conditions.push(eq(c.handledBy, f));
    return tx
      .select({
        id: c.id,
        customerId: c.customerId,
        customerName: schema.customers.name,
        customerPhone: schema.customers.phone,
        channel: c.channel,
        isTest: sql<boolean>`${cn.mode} = 'test'`,
        handledBy: c.handledBy,
        needsAttention: c.needsAttention,
        attentionReason: c.attentionReason,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        unreadCount: c.unreadCount,
      })
      .from(c)
      .innerJoin(schema.customers, eq(schema.customers.id, c.customerId))
      .innerJoin(cn, eq(cn.id, c.connectionId))
      .where(and(...conditions))
      .orderBy(desc(c.lastMessageAt))
      .limit(100);
  });
}

/** How many chats wait for the team (inbox badge). */
export async function countConversationsNeedingAttention(actor: ActorContext): Promise<number> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(c)
      .where(and(eq(c.status, 'open'), eq(c.needsAttention, true)));
    return row?.n ?? 0;
  });
}

export type ConversationView = {
  conversation: schema.Conversation;
  customer: Pick<schema.Customer, 'id' | 'name' | 'phone'>;
  connection: Pick<schema.ChannelConnection, 'mode' | 'displayName'>;
  messages: schema.Message[];
  window: ReplyWindow;
  agentEnabled: boolean;
};

/** One chat with its latest 200 messages. Opening it marks it read. */
export async function getConversation(
  actor: ActorContext,
  conversationId: string,
): Promise<ConversationView> {
  const id = z.uuid().parse(conversationId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const [row] = await tx
      .select({
        conversation: c,
        customer: {
          id: schema.customers.id,
          name: schema.customers.name,
          phone: schema.customers.phone,
        },
        connection: { mode: cn.mode, displayName: cn.displayName },
      })
      .from(c)
      .innerJoin(schema.customers, eq(schema.customers.id, c.customerId))
      .innerJoin(cn, eq(cn.id, c.connectionId))
      .where(eq(c.id, id))
      .limit(1);
    if (!row) throw new CoreError('not_found', 'This chat no longer exists.');
    if (row.conversation.unreadCount > 0) {
      await tx.update(c).set({ unreadCount: 0 }).where(eq(c.id, id));
    }
    const latest = await tx
      .select()
      .from(m)
      .where(eq(m.conversationId, id))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(200);
    const [settings] = await tx
      .select({ enabled: schema.agentSettings.enabled })
      .from(schema.agentSettings)
      .limit(1);
    return {
      conversation: { ...row.conversation, unreadCount: 0 },
      customer: row.customer,
      connection: row.connection,
      messages: latest.reverse(),
      window: replyWindow(row.conversation.channel, row.conversation.lastCustomerMessageAt),
      agentEnabled: settings?.enabled ?? false,
    };
  });
}

/** "Take over" (the team answers) or "Give back to the assistant". */
export async function setConversationHandler(
  actor: ActorContext,
  conversationId: string,
  handler: schema.ConversationHandler,
): Promise<void> {
  const id = z.uuid().parse(conversationId);
  const to = z.enum(schema.conversationHandlers).parse(handler);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const [conversation] = await tx.select().from(c).where(eq(c.id, id)).for('update').limit(1);
    if (!conversation) throw new CoreError('not_found', 'This chat no longer exists.');
    if (conversation.handledBy === to) return;
    await tx
      .update(c)
      .set(
        to === 'agent'
          ? { handledBy: 'agent', needsAttention: false, attentionReason: null }
          : { handledBy: 'human' },
      )
      .where(eq(c.id, id));
    await recordEvent(tx, actor.businessId, {
      type: 'conversation.handoff',
      actor: userActor(actor),
      customerId: conversation.customerId,
      payload: { conversationId: id, to, reason: to === 'human' ? 'taken_over' : 'given_back' },
    });
  });
}

// ─── Test chat ───────────────────────────────────────────────────────────────

async function testConnection(tx: Tx, actor: ActorContext): Promise<schema.ChannelConnection> {
  const [existing] = await tx
    .select()
    .from(cn)
    .where(and(eq(cn.mode, 'test'), eq(cn.externalAccountId, testAccountId(actor.businessId))))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(cn)
    .values({
      businessId: actor.businessId,
      channel: 'whatsapp',
      mode: 'test',
      externalAccountId: testAccountId(actor.businessId),
      displayName: 'Test chat',
      connectedBy: actor.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await tx
    .select()
    .from(cn)
    .where(eq(cn.externalAccountId, testAccountId(actor.businessId)))
    .limit(1);
  return again!;
}

/**
 * "Test chat": the owner writes as a pretend customer. The message goes through the same
 * pipeline as a real one (queued, then stored by the worker) and shows in the inbox,
 * marked "Test". It behaves like WhatsApp, including the 24-hour rule.
 */
export async function sendTestCustomerMessage(actor: ActorContext, text: string): Promise<void> {
  const body = replyInput.parse({ text }).text;
  const connection = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    return testConnection(tx, actor);
  });
  await enqueueInboundMessage(actor.businessId, connection.id, {
    externalId: `test-${randomUUID()}`,
    from: { externalUserId: TEST_CUSTOMER_ID, displayName: 'Test customer' },
    sentAt: new Date().toISOString(),
    type: 'text',
    text: body,
  });
}

export type TestChatView = { conversationId: string | null; messages: schema.Message[] };

/** The test chat as the pretend customer sees it. */
export async function getTestChat(actor: ActorContext): Promise<TestChatView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, INBOX);
    const [row] = await tx
      .select({ id: c.id })
      .from(c)
      .innerJoin(cn, eq(cn.id, c.connectionId))
      .where(and(eq(cn.mode, 'test'), eq(c.status, 'open')))
      .orderBy(desc(c.createdAt))
      .limit(1);
    if (!row) return { conversationId: null, messages: [] };
    const messages = await tx
      .select()
      .from(m)
      .where(eq(m.conversationId, row.id))
      .orderBy(asc(m.createdAt), asc(m.id))
      .limit(200);
    return { conversationId: row.id, messages };
  });
}
