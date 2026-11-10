import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps } from './_shared';
import { businesses } from './businesses';
import { templateStatus } from './conversations';

/**
 * What the owner wants to hear about on WhatsApp (A4). One row per business; defaults
 * until saved. Alerts need the owner's number.
 */
export const ownerNotificationSettings = pgTable(
  'owner_notification_settings',
  {
    businessId: uuid('business_id')
      .primaryKey()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** The owner's personal WhatsApp number (E.164). Alerts are off without it. */
    ownerWhatsapp: text('owner_whatsapp'),
    alertPaidOrders: boolean('alert_paid_orders').notNull().default(true),
    alertLowStock: boolean('alert_low_stock').notNull().default(true),
    alertUnmatchedPayments: boolean('alert_unmatched_payments').notNull().default(true),
    alertWaitingCustomers: boolean('alert_waiting_customers').notNull().default(true),
    briefingEnabled: boolean('briefing_enabled').notNull().default(true),
    /** Local time "HH:MM" (the business's time zone). */
    briefingTime: text('briefing_time').notNull().default('08:00'),
    /** Order confirmations, receipts and delivery updates to WhatsApp customers (A3b). */
    customerMessagesEnabled: boolean('customer_messages_enabled').notNull().default(true),
    ...timestamps,
  },
  (t) => [tenantPolicy('owner_notification_settings', t.businessId)],
).enableRLS();

export const ownerAlertStatuses = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
  'not_sent',
] as const;
export const ownerAlertStatus = pgEnum('owner_alert_status', ownerAlertStatuses);

/**
 * Every alert and daily briefing sent to an owner from Fulcra's WhatsApp number. The key
 * ("event:<id>", "briefing:<date>") makes each one happen once.
 */
export const ownerAlerts = pgTable(
  'owner_alerts',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** paid_order, low_stock, unmatched_payment, waiting_customer, briefing, test. */
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    eventId: uuid('event_id'),
    toPhone: text('to_phone').notNull(),
    /** Template values and the filled-in text (what the owner reads). */
    params: text('params')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    text: text('text').notNull(),
    status: ownerAlertStatus('status').notNull().default('pending'),
    /** WhatsApp's message id (delivery updates and cost). */
    externalId: text('external_id'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('owner_alerts_business_key_unique').on(t.businessId, t.dedupeKey),
    uniqueIndex('owner_alerts_external_id_unique').on(t.externalId),
    index('owner_alerts_business_created_idx').on(t.businessId, t.createdAt),
    tenantPolicy('owner_alerts', t.businessId),
  ],
).enableRLS();

/**
 * Message templates on Fulcra's own WhatsApp number (owner alerts and briefings). Fulcra-wide:
 * no business owns them, so no tenant policy; only system access reads them (decision 0003).
 */
export const platformTemplates = pgTable('platform_templates', {
  id: id(),
  purpose: text('purpose').notNull().unique(),
  name: text('name').notNull(),
  language: text('language').notNull().default('en'),
  category: text('category').notNull().default('utility'),
  body: text('body').notNull(),
  status: templateStatus('status').notNull().default('not_submitted'),
  externalId: text('external_id'),
  statusReason: text('status_reason'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps,
}).enableRLS();

export type OwnerNotificationSettings = typeof ownerNotificationSettings.$inferSelect;
export type OwnerAlert = typeof ownerAlerts.$inferSelect;
export type OwnerAlertStatus = (typeof ownerAlertStatuses)[number];
export type PlatformTemplate = typeof platformTemplates.$inferSelect;
