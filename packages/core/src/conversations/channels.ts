import { createHash } from 'node:crypto';
import { schema, withSystem, withTenant } from '@fulcra/db';
import { and, eq, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor } from '../events/events';
import { enqueueSubmitTemplates } from '../jobs/queue';
import { requireMember, type ActorContext } from '../members/access';
import { decryptSecret, encryptSecret } from '../shared/crypto';
import { CoreError, isUniqueViolation } from '../shared/errors';
import { ensureStarterTemplatesInTx, resetTemplatesInTx } from './templates';

/**
 * Channel connections and the platform's side of messaging: saving webhooks, finding which
 * business a platform account belongs to, delivery updates. The platform-specific parts
 * (signatures, formats, sending) are in the channel adapters (`@fulcra/channels`); these
 * services only see standard shapes. See docs/decisions/0013.
 */

const cn = schema.channelConnections;
const m = schema.messages;

// ─── Webhooks ────────────────────────────────────────────────────────────────

export type RecordChannelWebhookResult =
  | { status: 'saved'; webhookEventId: string }
  | { status: 'duplicate'; webhookEventId: string; processed: boolean }
  | { status: 'bad_payload' };

/**
 * Saves a channel webhook once (rule 9), after the route has checked its signature with the
 * adapter. Meta sends no event id, so the body's hash is the id: a redelivered webhook is the
 * same body. System access: the webhook names a platform account, not a business (0003).
 */
export async function recordChannelWebhook(
  channel: schema.Channel,
  rawBody: string,
): Promise<RecordChannelWebhookResult> {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { status: 'bad_payload' };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: 'bad_payload' };
  }
  const eventId = createHash('sha256').update(rawBody).digest('hex');
  const eventType = typeof payload.object === 'string' ? payload.object : 'webhook';
  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(schema.webhookEvents)
      .values({ provider: channel, eventId, eventType, payload })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (row) return { status: 'saved', webhookEventId: row.id } as const;
    const [existing] = await tx
      .select({ id: schema.webhookEvents.id, processedAt: schema.webhookEvents.processedAt })
      .from(schema.webhookEvents)
      .where(
        and(eq(schema.webhookEvents.provider, channel), eq(schema.webhookEvents.eventId, eventId)),
      )
      .limit(1);
    return {
      status: 'duplicate',
      webhookEventId: existing!.id,
      processed: existing!.processedAt !== null,
    } as const;
  });
}

/** Worker: a saved channel webhook to read (null when already processed or unknown). */
export async function claimChannelWebhook(
  webhookEventId: string,
): Promise<{ channel: schema.Channel; payload: Record<string, unknown> } | null> {
  const id = z.uuid().parse(webhookEventId);
  return withSystem(async (tx) => {
    const [row] = await tx
      .update(schema.webhookEvents)
      .set({ attempts: sqlIncrement() })
      .where(eq(schema.webhookEvents.id, id))
      .returning();
    if (!row || row.processedAt) return null;
    const channel = z.enum(schema.channels).safeParse(row.provider);
    return channel.success ? { channel: channel.data, payload: row.payload } : null;
  });
}

export async function markChannelWebhookProcessed(
  webhookEventId: string,
  error: string | null = null,
): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.webhookEvents)
      .set(error ? { lastError: error } : { processedAt: new Date(), lastError: null })
      .where(eq(schema.webhookEvents.id, z.uuid().parse(webhookEventId))),
  );
}

function sqlIncrement() {
  return sql`${schema.webhookEvents.attempts} + 1`;
}

export type ConnectionForAccount = {
  id: string;
  businessId: string;
  mode: schema.ChannelConnection['mode'];
  status: schema.ChannelConnection['status'];
  /** Decrypted secrets (access token…). */
  credentials: string | null;
};

/**
 * Which connection a platform account (e.g. a WhatsApp phone number id) belongs to. System
 * access: webhooks name the account, and the account is unique across businesses (0003).
 */
export async function findConnectionByAccount(
  channel: schema.Channel,
  externalAccountId: string,
): Promise<ConnectionForAccount | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select()
      .from(cn)
      .where(and(eq(cn.channel, channel), eq(cn.externalAccountId, externalAccountId)))
      .limit(1),
  );
  if (!row || row.status === 'disconnected') return null;
  return {
    id: row.id,
    businessId: row.businessId,
    mode: row.mode,
    status: row.status,
    credentials: row.credentials ? decryptSecret(row.credentials) : null,
  };
}

// ─── Delivery updates ────────────────────────────────────────────────────────

const STATUS_ORDER = { queued: 0, sent: 1, delivered: 2, read: 3 } as const;

export const messageStatusUpdate = z.object({
  externalId: z.string().min(1).max(200),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  error: z.string().max(500).optional(),
});
export type MessageStatusUpdateInput = z.input<typeof messageStatusUpdate>;

/**
 * Applies a delivery update to one of our sent messages. Ticks only move forward
 * (sent → delivered → read); a failure is kept with its reason. Returns "not_found" when
 * we don't know the message yet (the worker retries: "sent" can beat our own save).
 */
export async function applyMessageStatus(
  businessId: string,
  input: MessageStatusUpdateInput,
): Promise<'updated' | 'unchanged' | 'not_found'> {
  const update = messageStatusUpdate.parse(input);
  return withTenant(businessId, async (tx) => {
    const [message] = await tx
      .select({ id: m.id, status: m.status })
      .from(m)
      .where(and(eq(m.externalId, update.externalId), eq(m.direction, 'outbound')))
      .for('update')
      .limit(1);
    if (!message) return 'not_found';
    if (update.status === 'failed') {
      if (message.status === 'read' || message.status === 'failed') return 'unchanged';
      await tx
        .update(m)
        .set({ status: 'failed', error: update.error ?? 'Not delivered.' })
        .where(eq(m.id, message.id));
      return 'updated';
    }
    const current = STATUS_ORDER[message.status as keyof typeof STATUS_ORDER];
    if (current === undefined || current >= STATUS_ORDER[update.status]) return 'unchanged';
    await tx.update(m).set({ status: update.status }).where(eq(m.id, message.id));
    return 'updated';
  });
}

// ─── Connecting WhatsApp ─────────────────────────────────────────────────────

export const whatsAppConnectionInput = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'The phone number ID is a long number from Meta.'),
  businessAccountId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'The WhatsApp Business Account ID is a long number from Meta.'),
  accessToken: z.string().trim().min(20, 'Paste the access token from Meta.').max(1000),
  /** The two-step PIN Fulcra set when registering the number (Embedded Signup). */
  pin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** Checked with Meta by the caller (the adapter): the number as WhatsApp shows it. */
  displayName: z.string().trim().max(120).default(''),
});
export type WhatsAppConnectionInput = z.input<typeof whatsAppConnectionInput>;

export type ChannelConnectionView = Pick<
  schema.ChannelConnection,
  'id' | 'channel' | 'displayName' | 'status' | 'lastError' | 'createdAt' | 'externalAccountId'
>;

/** The business's real (not test) channel connections. */
export async function listChannelConnections(
  actor: ActorContext,
): Promise<ChannelConnectionView[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    return tx
      .select({
        id: cn.id,
        channel: cn.channel,
        displayName: cn.displayName,
        status: cn.status,
        lastError: cn.lastError,
        createdAt: cn.createdAt,
        externalAccountId: cn.externalAccountId,
      })
      .from(cn)
      .where(and(eq(cn.mode, 'live'), ne(cn.status, 'disconnected')));
  });
}

/**
 * Saves the business's WhatsApp number (owner only), after the caller has checked the
 * details with Meta. The token is stored encrypted (rule 11). One WhatsApp number per
 * business for now; a number can only belong to one business.
 */
export async function saveWhatsAppConnection(
  actor: ActorContext,
  input: WhatsAppConnectionInput,
): Promise<ChannelConnectionView> {
  const data = whatsAppConnectionInput.parse(input);
  const saved = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const values = {
      externalBusinessId: data.businessAccountId,
      displayName: data.displayName,
      credentials: encryptSecret(
        JSON.stringify({ accessToken: data.accessToken, ...(data.pin ? { pin: data.pin } : {}) }),
      ),
      status: 'connected' as const,
      lastError: null,
      connectedBy: actor.userId,
    };
    const [existing] = await tx
      .select()
      .from(cn)
      .where(and(eq(cn.channel, 'whatsapp'), eq(cn.mode, 'live')))
      .limit(1);
    let row: schema.ChannelConnection;
    try {
      if (existing) {
        [row] = (await tx
          .update(cn)
          .set({ ...values, externalAccountId: data.phoneNumberId })
          .where(eq(cn.id, existing.id))
          .returning()) as [schema.ChannelConnection];
      } else {
        [row] = (await tx
          .insert(cn)
          .values({
            ...values,
            businessId: actor.businessId,
            channel: 'whatsapp',
            mode: 'live',
            externalAccountId: data.phoneNumberId,
          })
          .returning()) as [schema.ChannelConnection];
      }
    } catch (error) {
      if (isUniqueViolation(error, 'channel_connections_account_unique'))
        throw new CoreError(
          'conflict',
          'This WhatsApp number is already connected to another Fulcra business.',
        );
      throw error;
    }
    // Templates belong to the WhatsApp Business Account: a new account means sending them again.
    if (existing && existing.externalBusinessId !== data.businessAccountId)
      await resetTemplatesInTx(tx, row.id);
    await ensureStarterTemplatesInTx(tx, actor.businessId, row.id);
    await recordEvent(tx, actor.businessId, {
      type: 'channel.connected',
      actor: userActor(actor),
      payload: { channel: 'whatsapp', connectionId: row.id, phoneNumberId: data.phoneNumberId },
    });
    return {
      id: row.id,
      channel: row.channel,
      displayName: row.displayName,
      status: row.status,
      lastError: row.lastError,
      createdAt: row.createdAt,
      externalAccountId: row.externalAccountId,
    };
  });
  // Meta reviews templates in minutes to hours; the worker sends them now.
  await enqueueSubmitTemplates(actor.businessId, saved.id);
  return saved;
}

/** Disconnects a channel (owner only). Chats stay; nothing more is received or sent. */
export async function disconnectChannel(actor: ActorContext, connectionId: string): Promise<void> {
  const id = z.uuid().parse(connectionId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [row] = await tx
      .update(cn)
      .set({ status: 'disconnected', credentials: null })
      .where(and(eq(cn.id, id), eq(cn.mode, 'live')))
      .returning({ channel: cn.channel });
    if (!row) throw new CoreError('not_found', 'This connection no longer exists.');
    await recordEvent(tx, actor.businessId, {
      type: 'channel.disconnected',
      actor: userActor(actor),
      payload: { channel: row.channel, connectionId: id },
    });
  });
}

/** Worker: marks a connection broken (e.g. Meta rejected the token) so the owner sees why. */
export async function markConnectionError(
  businessId: string,
  connectionId: string,
  error: string,
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(cn)
      .set({ status: 'error', lastError: error })
      .where(and(eq(cn.id, connectionId), ne(cn.status, 'disconnected'))),
  );
}

// ─── Read receipts ───────────────────────────────────────────────────────────

export type ReadReceiptTarget = {
  channel: schema.Channel;
  externalAccountId: string;
  credentials: string | null;
  /** The customer's message on the platform. */
  externalMessageId: string;
};

/**
 * For "seen" ticks and "typing…" while the assistant works on a reply: the customer's
 * message and the live connection to tell. Null for test chats or messages without an id.
 */
export async function readReceiptTarget(
  businessId: string,
  messageId: string,
): Promise<ReadReceiptTarget | null> {
  return withTenant(businessId, async (tx) => {
    const [row] = await tx
      .select({ message: m, connection: cn })
      .from(m)
      .innerJoin(schema.conversations, eq(schema.conversations.id, m.conversationId))
      .innerJoin(cn, eq(cn.id, schema.conversations.connectionId))
      .where(and(eq(m.id, z.uuid().parse(messageId)), eq(m.direction, 'inbound')))
      .limit(1);
    if (!row || row.connection.mode !== 'live' || row.connection.status !== 'connected')
      return null;
    if (!row.message.externalId) return null;
    return {
      channel: row.connection.channel,
      externalAccountId: row.connection.externalAccountId,
      credentials: row.connection.credentials ? decryptSecret(row.connection.credentials) : null,
      externalMessageId: row.message.externalId,
    };
  });
}

// ─── Connecting Instagram ────────────────────────────────────────────────────

export const instagramConnectionInput = z.object({
  /** The Instagram professional account id (what webhooks name). */
  accountId: z.string().regex(/^\d{5,30}$/),
  username: z.string().trim().max(60).default(''),
  accessToken: z.string().min(20).max(1000),
  expiresAt: z.coerce.date(),
});
export type InstagramConnectionInput = z.input<typeof instagramConnectionInput>;

/**
 * Saves the business's Instagram account after "Connect Instagram" (owner only). The
 * 60-day token is stored encrypted (rule 11) with its expiry; the worker renews it.
 */
export async function saveInstagramConnection(
  actor: ActorContext,
  input: InstagramConnectionInput,
): Promise<ChannelConnectionView> {
  const data = instagramConnectionInput.parse(input);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const values = {
      externalAccountId: data.accountId,
      displayName: data.username ? `@${data.username}` : '',
      credentials: encryptSecret(JSON.stringify({ accessToken: data.accessToken })),
      expiresAt: data.expiresAt,
      status: 'connected' as const,
      lastError: null,
      connectedBy: actor.userId,
    };
    const [existing] = await tx
      .select()
      .from(cn)
      .where(and(eq(cn.channel, 'instagram'), eq(cn.mode, 'live')))
      .limit(1);
    let row: schema.ChannelConnection;
    try {
      [row] = (
        existing
          ? await tx.update(cn).set(values).where(eq(cn.id, existing.id)).returning()
          : await tx
              .insert(cn)
              .values({
                ...values,
                businessId: actor.businessId,
                channel: 'instagram',
                mode: 'live',
              })
              .returning()
      ) as [schema.ChannelConnection];
    } catch (error) {
      if (isUniqueViolation(error, 'channel_connections_account_unique'))
        throw new CoreError(
          'conflict',
          'This Instagram account is already connected to another Fulcra business.',
        );
      throw error;
    }
    await recordEvent(tx, actor.businessId, {
      type: 'channel.connected',
      actor: userActor(actor),
      payload: { channel: 'instagram', connectionId: row.id, accountId: data.accountId },
    });
    return {
      id: row.id,
      channel: row.channel,
      displayName: row.displayName,
      status: row.status,
      lastError: row.lastError,
      createdAt: row.createdAt,
      externalAccountId: row.externalAccountId,
    };
  });
}

/** Renew Instagram tokens this many days before they run out (they last 60). */
const REFRESH_BEFORE_DAYS = 15;

/**
 * Worker (daily): Instagram connections whose token should be renewed now. System access:
 * the job walks all businesses (docs/decisions/0003).
 */
export async function instagramTokensToRefresh(
  now = new Date(),
): Promise<{ businessId: string; connectionId: string }[]> {
  const soon = new Date(now.getTime() + REFRESH_BEFORE_DAYS * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  return withSystem((tx) =>
    tx
      .select({ businessId: cn.businessId, connectionId: cn.id })
      .from(cn)
      .where(
        and(
          eq(cn.channel, 'instagram'),
          eq(cn.mode, 'live'),
          eq(cn.status, 'connected'),
          isNotNull(cn.expiresAt),
          lt(cn.expiresAt, soon),
          // Instagram only renews tokens that are at least a day old.
          lt(cn.updatedAt, dayAgo),
        ),
      ),
  );
}

/** Worker: the current token of a connection (null when it has run out or is gone). */
export async function connectionToken(
  businessId: string,
  connectionId: string,
  now = new Date(),
): Promise<string | null> {
  const [row] = await withTenant(businessId, (tx) =>
    tx
      .select()
      .from(cn)
      .where(eq(cn.id, z.uuid().parse(connectionId)))
      .limit(1),
  );
  if (!row?.credentials || row.status !== 'connected') return null;
  if (row.expiresAt && row.expiresAt < now) {
    await markConnectionError(
      businessId,
      connectionId,
      'The Instagram connection ran out. Connect Instagram again.',
    );
    return null;
  }
  const token = (JSON.parse(decryptSecret(row.credentials)) as { accessToken?: string })
    .accessToken;
  return token ?? null;
}

/** Worker: saves a renewed token and its new expiry. */
export async function saveRenewedToken(
  businessId: string,
  connectionId: string,
  token: { accessToken: string; expiresAt: Date },
): Promise<void> {
  await withTenant(businessId, (tx) =>
    tx
      .update(cn)
      .set({
        credentials: encryptSecret(JSON.stringify({ accessToken: token.accessToken })),
        expiresAt: token.expiresAt,
      })
      .where(eq(cn.id, connectionId)),
  );
}
