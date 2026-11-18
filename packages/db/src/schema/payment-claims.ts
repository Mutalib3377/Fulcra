import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps, type StoredImage } from './_shared';
import { businesses } from './businesses';
import { conversations, messages } from './conversations';
import { customers } from './customers';
import { orders } from './orders';

export const paymentClaimSources = [
  /** The customer sent a transfer receipt or debit alert screenshot. */
  'screenshot',
  /** The customer said they paid (no screenshot). */
  'customer_said',
] as const;
export const paymentClaimSource = pgEnum('payment_claim_source', paymentClaimSources);

export const paymentClaimStatuses = [
  /** Waiting for the money to arrive. */
  'waiting',
  /** The money arrived (Paystack link or the customer's own transfer account). */
  'confirmed',
  /** Nothing arrived in time; the owner is told not to send the goods. */
  'not_received',
  /** The owner closed it (e.g. paid outside Fulcra and checked in their bank app). */
  'dismissed',
] as const;
export const paymentClaimStatus = pgEnum('payment_claim_status', paymentClaimStatuses);

export const paymentClaimFlags = [
  /** The receipt's amount is not what the order still owes. */
  'amount_mismatch',
  /** The receipt is dated before the order was placed. */
  'dated_before_order',
  /** The receipt shows a time in the future. */
  'future_date',
  /** The same receipt reference was sent before for another order or customer. */
  'reused_reference',
] as const;
export type PaymentClaimFlag = (typeof paymentClaimFlags)[number];

/**
 * A customer saying they paid (F1, fake alert protection). What they claimed is checked
 * against the money that actually arrived; a screenshot is never proof. One per screenshot
 * message; amounts in kobo.
 */
export const paymentClaims = pgTable(
  'payment_claims',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    /** The order the claim is for, when the customer has one unpaid. */
    orderId: uuid('order_id'),
    conversationId: uuid('conversation_id'),
    /** The screenshot's message (one claim per screenshot). */
    messageId: uuid('message_id'),
    source: paymentClaimSource('source').notNull(),
    status: paymentClaimStatus('status').notNull().default('waiting'),
    /** Read from the screenshot (null when not readable or not a screenshot). */
    claimedAmount: integer('claimed_amount'),
    bank: text('bank'),
    senderName: text('sender_name'),
    reference: text('reference'),
    claimedPaidAt: timestamp('claimed_paid_at', { withTimezone: true }),
    /** The screenshot itself (our stored copy), for the owner to look at. */
    image: jsonb('image').$type<StoredImage>(),
    flags: text('flags')
      .array()
      .$type<PaymentClaimFlag[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** What actually arrived for the order when it was checked. */
    receivedAmount: integer('received_amount'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    notReceivedAt: timestamp('not_received_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: uuid('dismissed_by'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'payment_claims_customer_fk',
      columns: [t.customerId, t.businessId],
      foreignColumns: [customers.id, customers.businessId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'payment_claims_order_fk',
      columns: [t.orderId, t.businessId],
      foreignColumns: [orders.id, orders.businessId],
    }),
    foreignKey({
      name: 'payment_claims_conversation_fk',
      columns: [t.conversationId, t.businessId],
      foreignColumns: [conversations.id, conversations.businessId],
    }),
    foreignKey({
      name: 'payment_claims_message_fk',
      columns: [t.messageId, t.businessId],
      foreignColumns: [messages.id, messages.businessId],
    }),
    uniqueIndex('payment_claims_message_unique')
      .on(t.businessId, t.messageId)
      .where(sql`${t.messageId} is not null`),
    index('payment_claims_business_status_idx').on(t.businessId, t.status),
    index('payment_claims_order_idx').on(t.orderId),
    index('payment_claims_reference_idx')
      .on(t.businessId, t.reference)
      .where(sql`${t.reference} is not null`),
    tenantPolicy('payment_claims', t.businessId),
  ],
).enableRLS();

export type PaymentClaim = typeof paymentClaims.$inferSelect;
export type PaymentClaimStatus = (typeof paymentClaimStatuses)[number];
export type PaymentClaimSource = (typeof paymentClaimSources)[number];
