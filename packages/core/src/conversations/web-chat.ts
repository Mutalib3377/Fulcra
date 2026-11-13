import { randomBytes } from 'node:crypto';
import { schema, withSystem, withTenant } from '@fulcra/db';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor } from '../events/events';
import { enqueueInboundMessage } from '../jobs/queue';
import { imageUrl } from '../media/images';
import { requireMember, type ActorContext } from '../members/access';
import { storeUrl } from '../payments/urls';
import { CoreError } from '../shared/errors';
import { VISITOR_ID, WIDGET_KEY } from './web-chat-rules';

/**
 * The website chat widget (W1, docs/decisions/0017). A business turns it on and gets a
 * public key; visitors chat anonymously (a random id kept in their browser). Messages go
 * through the same queue, assistant and inbox as WhatsApp; the widget fetches replies.
 */

const cn = schema.channelConnections;
const c = schema.conversations;
const m = schema.messages;

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function newWidgetKey(): string {
  const bytes = randomBytes(24);
  return `wk_${Array.from(bytes, (b) => BASE62[b % 62]).join('')}`;
}

export type WebChatView = { connectionId: string; key: string; enabled: boolean } | null;

/** The business's website chat (null until turned on). Owner or staff. */
export async function getWebChat(actor: ActorContext): Promise<WebChatView> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [row] = await tx
      .select()
      .from(cn)
      .where(and(eq(cn.channel, 'web'), eq(cn.mode, 'live')))
      .limit(1);
    return row
      ? { connectionId: row.id, key: row.externalAccountId, enabled: row.status === 'connected' }
      : null;
  });
}

/** Turns the website chat on or off (owner only). The key stays the same when turned back on. */
export async function setWebChatEnabled(
  actor: ActorContext,
  enabled: boolean,
): Promise<WebChatView> {
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [row] = await tx
      .select()
      .from(cn)
      .where(and(eq(cn.channel, 'web'), eq(cn.mode, 'live')))
      .limit(1);
    if (row) {
      await tx
        .update(cn)
        .set({ status: enabled ? 'connected' : 'disconnected', lastError: null })
        .where(eq(cn.id, row.id));
    } else if (enabled) {
      const [created] = await tx
        .insert(cn)
        .values({
          businessId: actor.businessId,
          channel: 'web',
          mode: 'live',
          externalAccountId: newWidgetKey(),
          displayName: 'Website chat',
          connectedBy: actor.userId,
        })
        .returning({ id: cn.id });
      await recordEvent(tx, actor.businessId, {
        type: 'channel.connected',
        actor: userActor(actor),
        payload: { channel: 'web', connectionId: created!.id },
      });
    }
  });
  return getWebChat(actor);
}

type WidgetTarget = { businessId: string; connectionId: string };

/**
 * Which business a widget key belongs to (system access: the key comes from a public
 * website, docs/decisions/0003). Null when unknown or turned off.
 */
async function findWidget(key: string): Promise<WidgetTarget | null> {
  if (!WIDGET_KEY.test(key)) return null;
  const [row] = await withSystem((tx) =>
    tx
      .select({ businessId: cn.businessId, connectionId: cn.id, status: cn.status })
      .from(cn)
      .where(and(eq(cn.channel, 'web'), eq(cn.externalAccountId, key)))
      .limit(1),
  );
  return row && row.status === 'connected'
    ? { businessId: row.businessId, connectionId: row.connectionId }
    : null;
}

export type WidgetConfig = {
  businessName: string;
  colour: string;
  logoUrl: string | null;
  greeting: string;
  /** Sites allowed to use the key (see isAllowedWidgetOrigin). */
  websiteHost: string | null;
  storeHost: string;
};

/** What the widget shows (name, colour, logo, greeting). Null for an unknown key. */
export async function getWidgetConfig(key: string): Promise<WidgetConfig | null> {
  const target = await findWidget(key);
  if (!target) return null;
  return withTenant(target.businessId, async (tx) => {
    const [business] = await tx
      .select({
        name: schema.businesses.name,
        subdomain: schema.businesses.subdomain,
        websiteUrl: schema.businesses.websiteUrl,
      })
      .from(schema.businesses)
      .limit(1);
    const [kit] = await tx.select().from(schema.brandKits).limit(1);
    const [settings] = await tx
      .select({ greeting: schema.agentSettings.greeting })
      .from(schema.agentSettings)
      .limit(1);
    if (!business) return null;
    let websiteHost: string | null = null;
    try {
      websiteHost = business.websiteUrl ? new URL(business.websiteUrl).hostname : null;
    } catch {
      websiteHost = null;
    }
    return {
      businessName: business.name,
      colour: kit?.primaryColour ?? '#0f6b55',
      logoUrl: kit?.logo ? imageUrl(kit.logo, 'sm') : null,
      greeting: settings?.greeting || `Hi! Welcome to ${business.name}. How can we help you today?`,
      websiteHost,
      storeHost: new URL(storeUrl(business.subdomain)).host,
    };
  });
}

export const widgetMessageInput = z.object({
  visitorId: z.string().regex(VISITOR_ID),
  /** Made by the widget, so a message sent twice (slow network) is saved once. */
  messageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  text: z.string().trim().min(1, 'Type a message.').max(2000, 'This message is too long.'),
});

/**
 * A visitor's message from the widget: queued like any channel message (the worker saves it
 * and the assistant answers). Returns false for an unknown or switched-off key.
 */
export async function sendWidgetMessage(
  key: string,
  input: z.input<typeof widgetMessageInput>,
): Promise<boolean> {
  const data = widgetMessageInput.parse(input);
  const target = await findWidget(key);
  if (!target) return false;
  await enqueueInboundMessage(target.businessId, target.connectionId, {
    externalId: `web:${data.visitorId}:${data.messageId}`,
    from: { externalUserId: data.visitorId, displayName: '' },
    sentAt: new Date().toISOString(),
    type: 'text',
    text: data.text,
  });
  return true;
}

export type WidgetMessage = {
  id: string;
  /** "visitor" for their own messages, "shop" for the assistant and the team. */
  from: 'visitor' | 'shop';
  text: string;
  imageUrl: string | null;
  createdAt: string;
  /** The widget's own id for messages it sent (to replace its "sending…" copy). */
  clientId: string | null;
};

/**
 * The visitor's chat for the widget: messages after `after` (newest 50 when empty), and
 * whether a reply is on its way. With `seen`, the shop's messages are marked read.
 */
export async function getWidgetMessages(
  key: string,
  params: { visitorId: string; after?: string | null; seen?: boolean },
): Promise<{ messages: WidgetMessage[]; replying: boolean } | null> {
  const visitorId = z.string().regex(VISITOR_ID).parse(params.visitorId);
  const after = params.after ? z.coerce.date().parse(params.after) : null;
  const target = await findWidget(key);
  if (!target) return null;
  return withTenant(target.businessId, async (tx) => {
    const [identity] = await tx
      .select({ customerId: schema.customerIdentities.customerId })
      .from(schema.customerIdentities)
      .where(
        and(
          eq(schema.customerIdentities.channel, 'web'),
          eq(schema.customerIdentities.externalUserId, visitorId),
        ),
      )
      .limit(1);
    if (!identity) return { messages: [], replying: false };
    const [conversation] = await tx
      .select()
      .from(c)
      .where(and(eq(c.connectionId, target.connectionId), eq(c.customerId, identity.customerId)))
      .orderBy(desc(c.createdAt))
      .limit(1);
    if (!conversation) return { messages: [], replying: false };
    const visible = and(
      eq(m.conversationId, conversation.id),
      ne(m.status, 'failed'),
      // JavaScript dates stop at milliseconds; Postgres keeps microseconds.
      after
        ? sql`date_trunc('milliseconds', ${m.createdAt}) > ${after.toISOString()}::timestamptz`
        : undefined,
    );
    const rows = after
      ? await tx.select().from(m).where(visible).orderBy(asc(m.createdAt)).limit(100)
      : (await tx.select().from(m).where(visible).orderBy(desc(m.createdAt)).limit(50)).reverse();
    if (params.seen) {
      await tx
        .update(m)
        .set({ status: 'read' })
        .where(
          and(
            eq(m.conversationId, conversation.id),
            eq(m.direction, 'outbound'),
            inArray(m.status, ['sent', 'delivered']),
          ),
        );
    }
    const [last] = await tx
      .select({ direction: m.direction, createdAt: m.createdAt })
      .from(m)
      .where(eq(m.conversationId, conversation.id))
      .orderBy(desc(m.createdAt))
      .limit(1);
    const [settings] = await tx
      .select({ enabled: schema.agentSettings.enabled })
      .from(schema.agentSettings)
      .limit(1);
    const replying =
      last?.direction === 'inbound' &&
      conversation.handledBy === 'agent' &&
      settings?.enabled === true &&
      Date.now() - last.createdAt.getTime() < 90_000;
    const prefix = `web:${visitorId}:`;
    return {
      replying,
      messages: rows.map((row) => ({
        id: row.id,
        from: row.direction === 'inbound' ? 'visitor' : 'shop',
        text: row.text,
        imageUrl: row.media?.image ? imageUrl(row.media.image, 'md') : null,
        createdAt: row.createdAt.toISOString(),
        clientId: row.externalId?.startsWith(prefix) ? row.externalId.slice(prefix.length) : null,
      })),
    };
  });
}

/** For tests and the dashboard: throws when the key is unknown. */
export async function requireWidget(key: string): Promise<WidgetTarget> {
  const target = await findWidget(key);
  if (!target) throw new CoreError('not_found', 'This chat is not available.');
  return target;
}
