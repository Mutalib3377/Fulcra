import { sql } from 'drizzle-orm';
import {
  boolean,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps, type StoredImage } from './_shared';
import { businesses } from './businesses';

export const productSources = ['manual', 'shopify', 'woocommerce', 'csv', 'url'] as const;
export const productSource = pgEnum('product_source', productSources);

/** Amounts are integers in kobo (₦1 = 100 kobo). */
export const products = pgTable(
  'products',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Free text chosen by the seller; suggestions come from their existing categories. */
    category: text('category'),
    photos: jsonb('photos').$type<StoredImage[]>().notNull().default([]),
    retailPrice: integer('retail_price').notNull(),
    wholesalePrice: integer('wholesale_price'),
    wholesaleMinQty: integer('wholesale_min_qty'),
    /** Lowest price the owner accepts (used for bargaining later). */
    minPrice: integer('min_price'),
    /** A variant is "low stock" when its stock is at or below this. */
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    isActive: boolean('is_active').notNull().default(true),
    /** Shown in the "Featured" section of the store home page. */
    isFeatured: boolean('is_featured').notNull().default(false),
    /** Products are archived, never deleted, so old orders keep working. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    source: productSource('source').notNull().default('manual'),
    externalId: text('external_id'),
    ...timestamps,
  },
  (t) => [
    // Lets variants reference (id, business_id) so a variant can never point at another business's product.
    unique('products_id_business_unique').on(t.id, t.businessId),
    uniqueIndex('products_external_id_unique')
      .on(t.businessId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('products_business_category_idx').on(t.businessId, t.category),
    check('products_retail_price_positive', sql`${t.retailPrice} >= 0`),
    check(
      'products_wholesale_complete',
      sql`(${t.wholesalePrice} is null) = (${t.wholesaleMinQty} is null)`,
    ),
    check(
      'products_wholesale_valid',
      sql`${t.wholesalePrice} is null or (${t.wholesalePrice} >= 0 and ${t.wholesaleMinQty} >= 2)`,
    ),
    check('products_min_price_valid', sql`${t.minPrice} is null or ${t.minPrice} >= 0`),
    check('products_low_stock_threshold_valid', sql`${t.lowStockThreshold} >= 0`),
    tenantPolicy('products', t.businessId),
  ],
).enableRLS();

/**
 * Sellable versions of a product (size × colour), each with its own stock.
 * Every product has at least one variant; a product without options has one
 * default variant (`is_default`), hidden in the UI.
 */
export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    productId: uuid('product_id').notNull(),
    size: text('size'),
    colour: text('colour'),
    sku: text('sku'),
    stock: integer('stock').notNull().default(0),
    /** Price for this variant instead of the product's retail price. */
    priceOverride: integer('price_override'),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    externalId: text('external_id'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'product_variants_product_fk',
      columns: [t.productId, t.businessId],
      foreignColumns: [products.id, products.businessId],
    }).onDelete('cascade'),
    unique('product_variants_id_business_unique').on(t.id, t.businessId),
    uniqueIndex('product_variants_options_unique')
      .on(t.productId, sql`lower(coalesce(${t.size}, ''))`, sql`lower(coalesce(${t.colour}, ''))`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex('product_variants_sku_unique')
      .on(t.businessId, sql`lower(${t.sku})`)
      .where(sql`${t.sku} is not null and ${t.archivedAt} is null`),
    index('product_variants_product_idx').on(t.productId),
    check('product_variants_stock_not_negative', sql`${t.stock} >= 0`),
    check(
      'product_variants_price_override_valid',
      sql`${t.priceOverride} is null or ${t.priceOverride} >= 0`,
    ),
    tenantPolicy('product_variants', t.businessId),
  ],
).enableRLS();

export const stockMovementReasons = [
  'initial',
  'adjustment',
  'sale',
  'cancellation',
  'return',
  'import',
] as const;
export const stockMovementReason = pgEnum('stock_movement_reason', stockMovementReasons);

/** History of every stock change. Written only by Core stock services. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    businessId: uuid('business_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    change: integer('change').notNull(),
    stockAfter: integer('stock_after').notNull(),
    reason: stockMovementReason('reason').notNull(),
    note: text('note').notNull().default(''),
    /** User who made the change; null for automatic changes. */
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'stock_movements_variant_fk',
      columns: [t.variantId, t.businessId],
      foreignColumns: [productVariants.id, productVariants.businessId],
    }).onDelete('cascade'),
    index('stock_movements_variant_idx').on(t.variantId, t.createdAt),
    check('stock_movements_change_not_zero', sql`${t.change} <> 0`),
    check('stock_movements_stock_after_valid', sql`${t.stockAfter} >= 0`),
    tenantPolicy('stock_movements', t.businessId),
  ],
).enableRLS();

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type StockMovementReason = (typeof stockMovementReasons)[number];
export type ProductSource = (typeof productSources)[number];
