import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

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

/**
 * RLS policy limiting rows to the current business (docs/decisions/0003).
 * Use on every business-owned table, together with `.enableRLS()`.
 */
export function tenantPolicy(table: string, businessIdColumn: AnyPgColumn) {
  return pgPolicy(`${table}_tenant_isolation`, {
    for: 'all',
    to: appRole,
    using: sql`${businessIdColumn} = ${currentBusinessId}`,
    withCheck: sql`${businessIdColumn} = ${currentBusinessId}`,
  });
}

/**
 * A stored image. Files live in storage under `<path>/<size>.webp`
 * (sizes: sm 200px, md 600px, lg 1200px on the longest side).
 */
export type StoredImage = {
  /** Storage path prefix, e.g. `<businessId>/<imageId>`. */
  path: string;
  /** Size of the largest stored version, in pixels. */
  width: number;
  height: number;
};
