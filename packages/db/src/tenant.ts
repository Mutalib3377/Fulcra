import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Database } from './client';

/** A transaction handle. Services receive this instead of the raw database. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const businessIdSchema = z.uuid();

/**
 * Runs `fn` in a transaction scoped to one business.
 *
 * Inside the transaction the connection switches to the restricted `fulcra_app` role
 * and sets `app.business_id`, so Postgres row-level security only exposes this
 * business's rows (docs/decisions/0003). Always prefer this over `withSystem`.
 */
export async function withTenant<T>(
  businessId: string,
  fn: (tx: Tx) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  const id = businessIdSchema.parse(businessId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.business_id', ${id}, true)`);
    await tx.execute(sql`set local role fulcra_app`);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction WITHOUT tenant scoping (RLS is not applied).
 *
 * Only for the few operations that must work across businesses or before a business
 * exists: creating a business, checking subdomain availability, listing a user's
 * memberships, accepting an invite, resolving a store by subdomain, and webhook routing.
 * Every caller must be a named Core service. Never pass user input into these
 * queries without filtering by an id or a unique key.
 */
export async function withSystem<T>(
  fn: (tx: Tx) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  return db.transaction(fn);
}
