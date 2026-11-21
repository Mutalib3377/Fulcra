import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, tenantPolicy } from './_shared';

/**
 * Everything Fulcra's staff change for a business from the admin area (AD2): who, what,
 * when and why. Rows are only ever added. No foreign key on the business, so the record
 * outlives a deleted business.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    adminUserId: uuid('admin_user_id').notNull(),
    adminEmail: text('admin_email').notNull(),
    /** extend_trial, give_plan, set_limit, set_feature, suspend, unsuspend. */
    action: text('action').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admin_actions_business_created_idx').on(t.businessId, t.createdAt),
    index('admin_actions_created_idx').on(t.createdAt),
    // Sellers never read it; the policy keeps the usual guard on business-owned rows.
    tenantPolicy('admin_actions', t.businessId),
  ],
).enableRLS();

export type AdminAction = typeof adminActions.$inferSelect;
