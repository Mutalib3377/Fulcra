import { sql } from 'drizzle-orm';
import { pgRole, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The restricted role tenant queries run as (created in migration 0000). */
export const appRole = pgRole('fulcra_app').existing();

/** The business set for the current transaction by `withTenant`. NULL when unset. */
export const currentBusinessId = sql`nullif(current_setting('app.business_id', true), '')::uuid`;

export const id = () => uuid('id').primaryKey().defaultRandom();

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
