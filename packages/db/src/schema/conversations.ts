import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps, type StoredImage } from './_shared';
import { businesses } from './businesses';
import { channel, customers } from './customers';

/** live: a real WhatsApp number, Instagram account or website chat. test: the owner's "Test chat". */
export const connectionModes = ['live', 'test'] as const;
export const connectionMode = pgEnum('connection_mode', connectionModes);

export const connectionStatuses = ['connected', 'error', 'disconnected'] as const;
export const connectionStatus = pgEnum('connection_status', connectionStatuses);

/** A business's connected channel account. Tokens are encrypted (rule 11). */
export const channelConnections = pgTable(
  'channel_connections',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: channel('channel').notNull(),
    mode: connectionMode('mode').notNull().default('live'),
    /** The platform's id for the account (WhatsApp phone number id, Instagram account id…). */
    externalAccountId: text('external_account_id').notNull(),
    /** Shown to the owner, e.g. "+234 803 123 4567" or "@adastyles". */
    displayName: text('display_name').notNull().default(''),
    /** Access token and other secrets, encrypted with ENCRYPTION_KEY. */
    credentials: text('credentials'),
    status: connectionStatus('status').notNull().default('connected'),
    lastError: text('last_error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    connectedBy: uuid('connected_by'),
    ...timestamps,
  },
  (t) => [
    unique('channel_connections_id_business_unique').on(t.id, t.businessId),
    // Webhooks name the account; it must lead to exactly one connection.
    uniqueIndex('channel_connections_account_unique').on(t.channel, t.externalAccountId),
    tenantPolicy('channel_connections', t.businessId),
  ],
).enableRLS();

export const conversationStatuses = ['open', 'closed'] as const;
export const conversationStatus = pgEnum('conversation_status', conversationStatuses);

/** Who answers the customer: the AI assistant or a person on the team. */
export const conversationHandlers = ['agent', 'human'] as const;
export const conversationHandler = pgEnum('conversation_handler', conversationHandlers);

/** One chat with one customer on one channel account. */
export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    channel: channel('channel').notNull(),
    status: conversationStatus('status').notNull().default('open'),
    handledBy: conversationHandler('handled_by').notNull().default('agent'),
    /** Shown in the inbox until someone on the team replies or gives it back to the agent. */
    needsAttention: boolean('needs_attention').notNull().default(false),
    /** Plain-language reason, e.g. "Your assistant is off". */
    attentionReason: text('attention_reason'),
    /** Meta's 24-hour rule is counted from this (free-form replies only within 24 hours). */
    lastCustomerMessageAt: timestamp('last_customer_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text('last_message_preview').notNull().default(''),
    /** Customer messages the team has not opened yet. */
    unreadCount: integer('unread_count').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('conversations_id_business_unique').on(t.id, t.businessId),
    foreignKey({
      name: 'conversations_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversations_connection_fk',
      columns: [t.connectionId, t.businessId],
      foreignColumns: [channelConnections.id, channelConnections.businessId],
    }).onDelete('cascade'),
    // At most one open chat per customer per channel account.
    uniqueIndex('conversations_open_unique')
      .on(t.connectionId, t.customerId)
      .where(sql`${t.status} = 'open'`),
    index('conversations_business_last_message_idx').on(t.businessId, t.lastMessageAt),
    tenantPolicy('conversations', t.businessId),
  ],
).enableRLS();

export const messageDirections = ['inbound', 'outbound'] as const;
export const messageDirection = pgEnum('message_direction', messageDirections);

export const messageSenders = ['customer', 'agent', 'human', 'system'] as const;
export const messageSender = pgEnum('message_sender', messageSenders);

export const messageTypes = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'location',
  'buttons',
  'list',
  'button_reply',
  'unsupported',
] as const;
export const messageType = pgEnum('message_type', messageTypes);

/** received: inbound. queued → sent → delivered → read, or failed: outbound. */
export const messageStatuses = [
  'received',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export const messageStatus = pgEnum('message_status', messageStatuses);

/** A photo, voice note or file on a message. */
export type MessageMedia = {
  /** Stored copy (photos are resized like uploads). */
  image?: StoredImage;
  /** The platform's media id, to download it later. */
  providerMediaId?: string;
  mimeType?: string;
  caption?: string;
};

export const messages = pgTable(
  'messages',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    direction: messageDirection('direction').notNull(),
    sender: messageSender('sender').notNull(),
    /** Team member who wrote it (sender "human"). */
    sentByUserId: uuid('sent_by_user_id'),
    type: messageType('type').notNull().default('text'),
    text: text('text').notNull().default(''),
    media: jsonb('media').$type<MessageMedia>(),
    /** Buttons, list items, location coordinates, reply ids… depending on the type. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** The platform's message id. Unique, so a message delivered twice is saved once (rule 9). */
    externalId: text('external_id'),
    status: messageStatus('status').notNull(),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    unique('messages_id_business_unique').on(t.id, t.businessId),
    foreignKey({
      name: 'messages_conversation_fk',
      columns: [t.conversationId, t.businessId],
      foreignColumns: [conversations.id, conversations.businessId],
    }).onDelete('cascade'),
    uniqueIndex('messages_external_unique')
      .on(t.businessId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('messages_conversation_created_idx').on(t.conversationId, t.createdAt),
    tenantPolicy('messages', t.businessId),
  ],
).enableRLS();

/** Opening hours per weekday ("mon"…"sun") as [["09:00","18:00"]]; empty = closed that day. */
export type BusinessHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>
>;

/** How the AI assistant behaves for a business (filled in from A2). */
export const agentSettings = pgTable(
  'agent_settings',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .unique()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** Off until the owner switches the assistant on. */
    enabled: boolean('enabled').notNull().default(false),
    greeting: text('greeting').notNull().default(''),
    awayMessage: text('away_message').notNull().default(''),
    /** Null: the assistant answers at any time. */
    businessHours: jsonb('business_hours').$type<BusinessHours>(),
    /** Outside opening hours: keep selling and taking orders (true), or only send the away message. */
    afterHoursOrders: boolean('after_hours_orders').notNull().default(true),
    /** Returns, delivery, payment rules… in the owner's own words. */
    policies: text('policies').notNull().default(''),
    /** Topics the assistant always hands to a person ("discounts", "custom orders"…). */
    handoffTopics: text('handoff_topics')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (t) => [tenantPolicy('agent_settings', t.businessId)],
).enableRLS();

/** Audit trail of everything the assistant does (each tool call), filled from A2. */
export const agentActions = pgTable(
  'agent_actions',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    messageId: uuid('message_id'),
    tool: text('tool').notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown>>().notNull().default({}),
    ok: boolean('ok').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'agent_actions_conversation_fk',
      columns: [t.conversationId, t.businessId],
      foreignColumns: [conversations.id, conversations.businessId],
    }).onDelete('cascade'),
    index('agent_actions_conversation_idx').on(t.conversationId, t.createdAt),
    tenantPolicy('agent_actions', t.businessId),
  ],
).enableRLS();

export type ChannelConnection = typeof channelConnections.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AgentSettings = typeof agentSettings.$inferSelect;
export type AgentAction = typeof agentActions.$inferSelect;
export type ConversationHandler = (typeof conversationHandlers)[number];
export type MessageType = (typeof messageTypes)[number];
export type MessageStatus = (typeof messageStatuses)[number];
export type MessageSender = (typeof messageSenders)[number];
