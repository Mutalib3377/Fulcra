import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps } from './_shared';
import { businesses } from './businesses';
import { productVariants } from './catalog';
import { customers, deliveryZones } from './customers';

export const orderStatuses = [
  'new',
  'awaiting_payment',
  'paid',
  'dispatched',
  'delivered',
  'cancelled',
] as const;
export const orderStatus = pgEnum('order_status', orderStatuses);

export const orderChannels = ['manual', 'whatsapp', 'instagram', 'web', 'store'] as const;
export const orderChannel = pgEnum('order_channel', orderChannels);

export const fulfilmentMethods = ['delivery', 'pickup'] as const;
export const fulfilmentMethod = pgEnum('fulfilment_method', fulfilmentMethods);

/** Amounts are kobo. total = subtotal + delivery_fee − discount. */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** Friendly number per business: #1001, #1002… */
    orderNumber: integer('order_number').notNull(),
    customerId: uuid('customer_id').notNull(),
    status: orderStatus('status').notNull().default('new'),
    channel: orderChannel('channel').notNull().default('manual'),
    fulfilment: fulfilmentMethod('fulfilment').notNull(),
    deliveryZoneId: uuid('delivery_zone_id'),
    /** Copies at order time, so later changes to the zone don't change the order. */
    deliveryZoneName: text('delivery_zone_name').notNull().default(''),
    deliveryAddress: text('delivery_address').notNull().default(''),
    subtotal: integer('subtotal').notNull(),
    deliveryFee: integer('delivery_fee').notNull().default(0),
    discount: integer('discount').notNull().default(0),
    total: integer('total').notNull(),
    amountPaid: integer('amount_paid').notNull().default(0),
    /** How a manually recorded payment was made (cash, transfer, pos, other). */
    paymentMethod: text('payment_method'),
    notes: text('notes').notNull().default(''),
    cancelReason: text('cancel_reason').notNull().default(''),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [
    unique('orders_id_business_unique').on(t.id, t.businessId),
    unique('orders_number_unique').on(t.businessId, t.orderNumber),
    foreignKey({
      name: 'orders_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }),
    foreignKey({
      name: 'orders_delivery_zone_fk',
      columns: [t.deliveryZoneId, t.businessId],
      foreignColumns: [deliveryZones.id, deliveryZones.businessId],
    }),
    index('orders_business_status_idx').on(t.businessId, t.status, t.createdAt),
    index('orders_customer_idx').on(t.customerId),
    check(
      'orders_amounts_valid',
      sql`${t.subtotal} >= 0 and ${t.deliveryFee} >= 0 and ${t.discount} >= 0 and ${t.amountPaid} >= 0`,
    ),
    check(
      'orders_total_valid',
      sql`${t.total} = ${t.subtotal} + ${t.deliveryFee} - ${t.discount} and ${t.total} >= 0`,
    ),
    check('orders_pickup_no_fee', sql`${t.fulfilment} = 'delivery' or ${t.deliveryFee} = 0`),
    tenantPolicy('orders', t.businessId),
  ],
).enableRLS();

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    orderId: uuid('order_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    productId: uuid('product_id').notNull(),
    /** Copies at order time (receipts never change). */
    productName: text('product_name').notNull(),
    variantLabel: text('variant_label').notNull().default(''),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    isWholesale: boolean('is_wholesale').notNull().default(false),
    lineTotal: integer('line_total').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'order_items_order_fk',
      columns: [t.orderId, t.businessId],
      foreignColumns: [orders.id, orders.businessId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'order_items_variant_fk',
      columns: [t.variantId, t.businessId],
      foreignColumns: [productVariants.id, productVariants.businessId],
    }),
    index('order_items_order_idx').on(t.orderId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'order_items_line_total_valid',
      sql`${t.unitPrice} >= 0 and ${t.lineTotal} = ${t.quantity} * ${t.unitPrice}`,
    ),
    tenantPolicy('order_items', t.businessId),
  ],
).enableRLS();

export const eventActors = ['user', 'system', 'agent', 'customer'] as const;
export const eventActor = pgEnum('event_actor', eventActors);

/**
 * Important things that happened (order.created, stock.low, …), newest last.
 * Written in the same transaction as the action. Other parts react to them via jobs.
 */
export const events = pgTable(
  'events',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorType: eventActor('actor_type').notNull(),
    actorId: uuid('actor_id'),
    orderId: uuid('order_id'),
    customerId: uuid('customer_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'events_order_fk',
      columns: [t.orderId, t.businessId],
      foreignColumns: [orders.id, orders.businessId],
    }),
    foreignKey({
      name: 'events_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }),
    index('events_business_created_idx').on(t.businessId, t.createdAt),
    index('events_order_idx').on(t.orderId),
    index('events_customer_idx').on(t.customerId),
    check('events_type_format', sql`${t.type} ~ '^[a-z_]+\\.[a-z_]+$'`),
    tenantPolicy('events', t.businessId),
  ],
).enableRLS();

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatus = (typeof orderStatuses)[number];
export type OrderChannel = (typeof orderChannels)[number];
export type FulfilmentMethod = (typeof fulfilmentMethods)[number];
export type Event = typeof events.$inferSelect;
export type EventActor = (typeof eventActors)[number];
