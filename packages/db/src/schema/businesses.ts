import { BUSINESS_CATEGORIES } from '@fulcra/config';
import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgEnum, pgPolicy, pgTable, text } from 'drizzle-orm/pg-core';
import { appRole, currentBusinessId, id, timestamps } from './_shared';

export const businessCategories = BUSINESS_CATEGORIES;
export const businessCategory = pgEnum('business_category', businessCategories);

export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    name: text('name').notNull(),
    /** Store address: <subdomain>.yourdomain.com. Lowercase, unique. */
    subdomain: text('subdomain').notNull().unique(),
    category: businessCategory('category').notNull(),
    /** E.164, e.g. +2348012345678. */
    whatsappNumber: text('whatsapp_number').notNull(),
    timezone: text('timezone').notNull().default('Africa/Lagos'),
    hasExternalWebsite: boolean('has_external_website').notNull().default(false),
    websiteUrl: text('website_url'),
    /** Set during payment setup (P1, docs/decisions/0001). */
    paystackSubaccountCode: text('paystack_subaccount_code'),
    /** Last order number used; the next order gets this + 1 (orders start at #1001). */
    lastOrderNumber: integer('last_order_number').notNull().default(1000),
    ...timestamps,
  },
  (t) => [
    check(
      'businesses_subdomain_format',
      sql`${t.subdomain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
    pgPolicy('businesses_tenant_isolation', {
      for: 'all',
      to: appRole,
      using: sql`${t.id} = ${currentBusinessId}`,
      withCheck: sql`${t.id} = ${currentBusinessId}`,
    }),
  ],
).enableRLS();

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
