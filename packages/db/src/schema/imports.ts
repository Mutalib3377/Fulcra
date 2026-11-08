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
import { products } from './catalog';

/** Where an import's products come from. */
export const catalogImportKinds = ['csv', 'shopify', 'woocommerce', 'url'] as const;
export const catalogImportKind = pgEnum('catalog_import_kind', catalogImportKinds);

/**
 * queued → fetching → review (seller checks the products) → saving → done.
 * Shopify and WooCommerce skip review. failed / cancelled end an import early.
 */
export const catalogImportStatuses = [
  'queued',
  'fetching',
  'review',
  'saving',
  'done',
  'failed',
  'cancelled',
] as const;
export const catalogImportStatus = pgEnum('catalog_import_status', catalogImportStatuses);

/** One run of bringing products in from a file, a shop or a website. */
export const catalogImports = pgTable(
  'catalog_imports',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: catalogImportKind('kind').notNull(),
    status: catalogImportStatus('status').notNull().default('queued'),
    /** What the seller imported from: a file name, shop address or website link. */
    label: text('label').notNull().default(''),
    /** Products found, and how many of those have been saved so far (progress). */
    totalItems: integer('total_items').notNull().default(0),
    processedItems: integer('processed_items').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    /** Plain-language reason when the whole import failed. */
    error: text('error'),
    createdBy: uuid('created_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('catalog_imports_id_business_unique').on(t.id, t.businessId),
    index('catalog_imports_business_created_idx').on(t.businessId, t.createdAt),
    check(
      'catalog_imports_counts_valid',
      sql`${t.processedItems} >= 0 and ${t.processedItems} <= ${t.totalItems}`,
    ),
    tenantPolicy('catalog_imports', t.businessId),
  ],
).enableRLS();

/** One option (size × colour) of an imported product. */
export type ImportedVariant = {
  externalId: string | null;
  size: string | null;
  colour: string | null;
  sku: string | null;
  /** Null when the source does not say: existing stock is left as it is. */
  stock: number | null;
  /** Kobo. Null means the product's retail price. */
  priceOverride: number | null;
};

/** A product as read from a source, before it is saved. Amounts in kobo. */
export type ImportedProduct = {
  externalId: string | null;
  name: string;
  description: string;
  category: string | null;
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  /** Public photo links; downloaded and resized when the product is saved. */
  photoUrls: string[];
  /** One entry with no size or colour for a product without options. */
  variants: ImportedVariant[];
};

export type ImportProblem = {
  /** Errors stop the product from being saved; warnings do not. */
  level: 'error' | 'warning';
  message: string;
};

export const importItemDecisions = ['pending', 'approved', 'skipped'] as const;
export const importItemDecision = pgEnum('import_item_decision', importItemDecisions);

export const importItemResults = ['created', 'updated', 'failed'] as const;
export const importItemResult = pgEnum('import_item_result', importItemResults);

/** A product found by an import, waiting for review or being saved. */
export const catalogImportItems = pgTable(
  'catalog_import_items',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    importId: uuid('import_id').notNull(),
    /** Order in the source (e.g. CSV row of the product's first line). */
    position: integer('position').notNull(),
    /** Where in the source it came from, for messages: "Row 4", a link… */
    sourceRef: text('source_ref').notNull().default(''),
    data: jsonb('data').$type<ImportedProduct>().notNull(),
    problems: jsonb('problems').$type<ImportProblem[]>().notNull().default([]),
    decision: importItemDecision('decision').notNull().default('pending'),
    result: importItemResult('result'),
    /** Why saving failed (e.g. a photo could not be downloaded). */
    resultMessage: text('result_message'),
    productId: uuid('product_id'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'catalog_import_items_import_fk',
      columns: [t.importId, t.businessId],
      foreignColumns: [catalogImports.id, catalogImports.businessId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'catalog_import_items_product_fk',
      columns: [t.productId, t.businessId],
      // Products are archived, never deleted (a set-null here would also clear business_id).
      foreignColumns: [products.id, products.businessId],
    }),
    index('catalog_import_items_import_idx').on(t.importId, t.position),
    tenantPolicy('catalog_import_items', t.businessId),
  ],
).enableRLS();

export type CatalogImport = typeof catalogImports.$inferSelect;
export type CatalogImportItem = typeof catalogImportItems.$inferSelect;
export type CatalogImportKind = (typeof catalogImportKinds)[number];
export type CatalogImportStatus = (typeof catalogImportStatuses)[number];
