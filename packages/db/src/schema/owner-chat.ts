import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
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

export const ownerChatChannels = ['dashboard', 'whatsapp'] as const;
export const ownerChatChannel = pgEnum('owner_chat_channel', ownerChatChannels);

/**
 * A change the owner asked for in chat, waiting for their YES (O1). Saved as data so the YES
 * runs exactly this, never a fresh reading by the AI.
 */
export type OwnerPendingAction = {
  kind: string;
  params: Record<string, unknown>;
  /** What the owner was asked to confirm, e.g. "Add Ankara dress, ₦15,000, 5 in stock". */
  summary: string;
};

/**
 * The owner's own chat with Fulcra's assistant (O1): to ask about sales, orders and stock and
 * to make changes. One per business and door (dashboard, or WhatsApp from the owner's number).
 */
export const ownerChats = pgTable(
  'owner_chats',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    channel: ownerChatChannel('channel').notNull(),
    /** The owner's WhatsApp number (E.164) for WhatsApp; "dashboard" for the dashboard. */
    externalUserId: text('external_user_id').notNull(),
    pendingAction: jsonb('pending_action').$type<OwnerPendingAction>(),
    pendingExpiresAt: timestamp('pending_expires_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique('owner_chats_id_business_unique').on(t.id, t.businessId),
    uniqueIndex('owner_chats_business_channel_user_unique').on(
      t.businessId,
      t.channel,
      t.externalUserId,
    ),
    tenantPolicy('owner_chats', t.businessId),
  ],
).enableRLS();

export const ownerChatSenders = ['owner', 'assistant'] as const;
export const ownerChatSender = pgEnum('owner_chat_sender', ownerChatSenders);

export const ownerChatMessageStatuses = ['received', 'queued', 'sent', 'failed'] as const;
export const ownerChatMessageStatus = pgEnum('owner_chat_message_status', ownerChatMessageStatuses);

/** Messages in an owner chat. Owner messages count towards the monthly fair-use limit. */
export const ownerChatMessages = pgTable(
  'owner_chat_messages',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').notNull(),
    sender: ownerChatSender('sender').notNull(),
    text: text('text').notNull().default(''),
    /** A photo the owner sent (e.g. for a new product). */
    image: jsonb('image').$type<StoredImage>(),
    /** WhatsApp message id (incoming: saved once; outgoing: delivery). */
    externalId: text('external_id'),
    status: ownerChatMessageStatus('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.chatId, t.businessId],
      foreignColumns: [ownerChats.id, ownerChats.businessId],
      name: 'owner_chat_messages_chat_fk',
    }).onDelete('cascade'),
    index('owner_chat_messages_chat_created_idx').on(t.chatId, t.createdAt),
    index('owner_chat_messages_business_created_idx').on(t.businessId, t.createdAt),
    uniqueIndex('owner_chat_messages_external_unique')
      .on(t.businessId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    tenantPolicy('owner_chat_messages', t.businessId),
  ],
).enableRLS();

export type OwnerChat = typeof ownerChats.$inferSelect;
export type OwnerChatMessage = typeof ownerChatMessages.$inferSelect;
export type OwnerChatChannel = (typeof ownerChatChannels)[number];
