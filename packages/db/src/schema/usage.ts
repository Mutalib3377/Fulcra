import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy } from './_shared';
import { businesses } from './businesses';

/** What was used (rule 12): an AI call, or a WhatsApp message Meta charges for (A3). */
export const usageKinds = ['ai_call', 'whatsapp_message'] as const;
export const usageKind = pgEnum('usage_kind', usageKinds);

/**
 * The cost of every AI call (and later every WhatsApp conversation), against the business
 * that caused it. Used for plan limits and billing (B1) and to watch our own costs.
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: usageKind('kind').notNull(),
    /** Which feature caused it, e.g. "catalog_import.url" or "agent.reply". */
    feature: text('feature').notNull(),
    /** AI model that served the call. */
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Count of the thing used (1 per AI call, 1 per conversation). */
    quantity: integer('quantity').notNull().default(1),
    /**
     * The provider's id for what was charged (e.g. the WhatsApp message id). Unique per kind,
     * so a delivery update received twice is charged once (rule 9).
     */
    reference: text('reference'),
    /** In US dollars, as providers bill. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_records_business_created_idx').on(t.businessId, t.createdAt),
    uniqueIndex('usage_records_kind_reference_unique').on(t.kind, t.reference),
    tenantPolicy('usage_records', t.businessId),
  ],
).enableRLS();

export type UsageRecord = typeof usageRecords.$inferSelect;
export type UsageKind = (typeof usageKinds)[number];
