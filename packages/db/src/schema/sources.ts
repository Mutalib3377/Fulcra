import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps } from './_shared';
import { businesses } from './businesses';

/** Shops a business imports products from (CSV files need no connection). */
export const catalogSourceKinds = ['shopify', 'woocommerce'] as const;
export const catalogSourceKind = pgEnum('catalog_source_kind', catalogSourceKinds);

/** connected: ready to import; error: the last import could not reach the shop. */
export const catalogSourceStatuses = ['connected', 'error', 'disconnected'] as const;
export const catalogSourceStatus = pgEnum('catalog_source_status', catalogSourceStatuses);

export const catalogSources = pgTable(
  'catalog_sources',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: catalogSourceKind('kind').notNull(),
    status: catalogSourceStatus('status').notNull().default('connected'),
    /** Shopify: mystore.myshopify.com. WooCommerce: https://mystore.com. */
    shopUrl: text('shop_url').notNull(),
    /** Access keys, encrypted with ENCRYPTION_KEY (never stored in plain text). Null once disconnected. */
    credentials: text('credentials'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Plain-language reason when status is "error". */
    lastError: text('last_error'),
    connectedBy: uuid('connected_by'),
    ...timestamps,
  },
  (t) => [
    // One connection per kind per business; reconnecting replaces it.
    unique('catalog_sources_business_kind_unique').on(t.businessId, t.kind),
    unique('catalog_sources_id_business_unique').on(t.id, t.businessId),
    // Shopify tells us the shop when the app is uninstalled; find its connections fast.
    index('catalog_sources_kind_shop_idx').on(t.kind, t.shopUrl),
    tenantPolicy('catalog_sources', t.businessId),
  ],
).enableRLS();

export type CatalogSource = typeof catalogSources.$inferSelect;
export type CatalogSourceKind = (typeof catalogSourceKinds)[number];
export type CatalogSourceStatus = (typeof catalogSourceStatuses)[number];
