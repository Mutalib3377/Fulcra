/**
 * Drizzle schema.
 *
 * Every business-owned table has `business_id`, RLS enabled (`.enableRLS()`) and a
 * policy for the `fulcra_app` role limiting rows to the current business. The RLS
 * coverage test fails if a table is missing either.
 */
export * from './businesses';
export * from './members';
export { appRole } from './_shared';
