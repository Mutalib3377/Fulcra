import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps } from './_shared';
import { businesses } from './businesses';

/** Where a business delivers, with a fixed fee. Archived, never deleted (orders keep a copy). */
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Kobo. */
    fee: integer('fee').notNull(),
    /** Free text shown to customers, e.g. "Same day" or "1–2 days". */
    estimatedTime: text('estimated_time').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('delivery_zones_id_business_unique').on(t.id, t.businessId),
    uniqueIndex('delivery_zones_name_unique')
      .on(t.businessId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check('delivery_zones_fee_valid', sql`${t.fee} >= 0`),
    tenantPolicy('delivery_zones', t.businessId),
  ],
).enableRLS();

export const customers = pgTable(
  'customers',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default(''),
    /** E.164 (+234…). Optional: Instagram-only customers may have no phone. */
    phone: text('phone'),
    email: text('email'),
    /** Default delivery address and zone, filled from their orders. */
    address: text('address').notNull().default(''),
    deliveryZoneId: uuid('delivery_zone_id'),
    /** Owner's own tags, e.g. "VIP". */
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes').notNull().default(''),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('customers_id_business_unique').on(t.id, t.businessId),
    uniqueIndex('customers_phone_unique')
      .on(t.businessId, t.phone)
      .where(sql`${t.phone} is not null`),
    foreignKey({
      name: 'customers_delivery_zone_fk',
      columns: [t.deliveryZoneId, t.businessId],
      foreignColumns: [deliveryZones.id, deliveryZones.businessId],
    }),
    index('customers_business_name_idx').on(t.businessId, t.name),
    check('customers_phone_e164', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    tenantPolicy('customers', t.businessId),
  ],
).enableRLS();

export const channels = ['whatsapp', 'instagram', 'web'] as const;
export const channel = pgEnum('channel', channels);

/** One customer, many channel identities (WhatsApp number, Instagram user, website visitor). */
export const customerIdentities = pgTable(
  'customer_identities',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    channel: channel('channel').notNull(),
    externalUserId: text('external_user_id').notNull(),
    displayName: text('display_name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'customer_identities_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }).onDelete('cascade'),
    uniqueIndex('customer_identities_unique').on(t.businessId, t.channel, t.externalUserId),
    index('customer_identities_customer_idx').on(t.customerId),
    tenantPolicy('customer_identities', t.businessId),
  ],
).enableRLS();

export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerIdentity = typeof customerIdentities.$inferSelect;
export type Channel = (typeof channels)[number];
