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
import { customers } from './customers';
import { orders } from './orders';

export const paymentProviders = ['paystack', 'manual'] as const;
export const paymentProvider = pgEnum('payment_provider', paymentProviders);

export const paymentStatuses = [
  'pending',
  'success',
  'failed',
  'needs_review',
  /** A transfer we could not match to an order (P2). */
  'unmatched',
  /** The owner said this money is not for an order. */
  'dismissed',
] as const;
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
    /** Null for a transfer not (yet) matched to an order. */
    orderId: uuid('order_id'),
    /** Who paid, when known (always for dedicated-account transfers). */
    customerId: uuid('customer_id'),
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
    foreignKey({
      name: 'payments_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }),
    index('payments_order_idx').on(t.orderId),
    index('payments_customer_idx').on(t.customerId),
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

export const dedicatedAccountStatuses = ['pending', 'active', 'failed'] as const;
export const dedicatedAccountStatus = pgEnum('dedicated_account_status', dedicatedAccountStatuses);

/**
 * A bank account number just for one customer of one business (docs/decisions/0002).
 * Transfers into it settle to the business's subaccount and tell us exactly who paid.
 */
export const dedicatedAccounts = pgTable(
  'dedicated_accounts',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    provider: paymentProvider('provider').notNull().default('paystack'),
    /** Paystack customer created for this business-customer pair. */
    providerCustomerCode: text('provider_customer_code'),
    accountNumber: text('account_number'),
    accountName: text('account_name'),
    bankName: text('bank_name'),
    status: dedicatedAccountStatus('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'dedicated_accounts_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }).onDelete('cascade'),
    unique('dedicated_accounts_customer_unique').on(t.businessId, t.customerId),
    unique('dedicated_accounts_provider_customer_unique').on(t.provider, t.providerCustomerCode),
    unique('dedicated_accounts_account_number_unique').on(t.provider, t.accountNumber),
    tenantPolicy('dedicated_accounts', t.businessId),
  ],
).enableRLS();

export type DedicatedAccount = typeof dedicatedAccounts.$inferSelect;
