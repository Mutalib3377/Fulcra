import { sql } from 'drizzle-orm';
import {
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
import { orders } from './orders';

export const paymentProviders = ['paystack', 'manual'] as const;
export const paymentProvider = pgEnum('payment_provider', paymentProviders);

export const paymentStatuses = ['pending', 'success', 'failed', 'needs_review'] as const;
export const paymentStatus = pgEnum('payment_status', paymentStatuses);

/**
 * Every payment attempt and confirmed payment. A provider reference is unique, so the same
 * payment can never be recorded twice (rule 9). Amounts are kobo.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    provider: paymentProvider('provider').notNull(),
    reference: text('reference').notNull(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('NGN'),
    status: paymentStatus('status').notNull().default('pending'),
    /** card, bank_transfer, ussd… (Paystack) or cash, transfer, pos, other (manual). */
    method: text('method'),
    /** Paystack checkout page for a payment link. */
    checkoutUrl: text('checkout_url'),
    /** Amount Paystack reported, when it differs (needs review). */
    reportedAmount: integer('reported_amount'),
    reviewReason: text('review_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    providerData: jsonb('provider_data').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => [
    unique('payments_provider_reference_unique').on(t.provider, t.reference),
    foreignKey({
      name: 'payments_order_fk',
      columns: [t.orderId, t.businessId],
      foreignColumns: [orders.id, orders.businessId],
    }),
    index('payments_order_idx').on(t.orderId),
    index('payments_business_status_idx').on(t.businessId, t.status),
    check('payments_amount_positive', sql`${t.amount} > 0`),
    tenantPolicy('payments', t.businessId),
  ],
).enableRLS();

/**
 * Raw webhooks as received, before we know which business they belong to.
 * System-only: RLS is on with no policy, so the app role can never read it;
 * Core accesses it through `withSystem`.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: id(),
    provider: text('provider').notNull(),
    /** Provider's event id, or one we derive from the event (e.g. "charge.success:<transaction id>"). */
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [unique('webhook_events_provider_event_unique').on(t.provider, t.eventId)],
).enableRLS();

export type Payment = typeof payments.$inferSelect;
export type PaymentStatus = (typeof paymentStatuses)[number];
export type PaymentProvider = (typeof paymentProviders)[number];
export type WebhookEvent = typeof webhookEvents.$inferSelect;
