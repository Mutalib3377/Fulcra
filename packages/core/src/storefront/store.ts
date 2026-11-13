import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { BRAND_KIT_DEFAULTS } from '../brand-kit/brand-kit';
import { variantLabel } from '../catalog/rules';
import { storeStockStatus, type StockStatus } from './rules';

/**
 * Public storefront reads. Customers are not signed in, so these take no actor.
 * The store is found by its address with a system lookup (docs/decisions/0003); everything
 * after that runs inside the business with `withTenant`, so RLS still applies.
 * Only active, non-archived products and options are ever returned.
 */

export const FEATURED_LIMIT = 8;
export const STORE_PAGE_SIZE = 24;

/** What a public store page may show about a business. Nothing private (payouts, codes). */
export type StoreInfo = {
  businessId: string;
  name: string;
  subdomain: string;
  whatsappNumber: string;
  /** The website chat key when the chat is on (the store shows the chat bubble). */
  webChatKey: string | null;
  brand: {
    logo: schema.StoredImage | null;
    primaryColour: string;
    accentColour: string;
    font: schema.BrandFont;
    description: string;
  };
};

export type StoreProductCard = {
  id: string;
  name: string;
  photo: schema.StoredImage | null;
  /** Lowest price across options, in kobo. */
  price: number;
  /** True when options have different prices ("From ₦…"). */
  hasPriceRange: boolean;
  soldOut: boolean;
};

export type StoreCategory = { name: string; productCount: number };

export type StoreHome = {
  featured: StoreProductCard[];
  /** True when the owner picked featured products; false when showing the newest. */
  featuredIsPicked: boolean;
  categories: StoreCategory[];
  productCount: number;
};

export type StoreVariant = {
  id: string;
  size: string | null;
  colour: string | null;
  /** "M / Red"; empty for a product without sizes or colours. */
  label: string;
  price: number;
  stock: StockStatus;
};

export type StoreProduct = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  photos: schema.StoredImage[];
  wholesale: { price: number; minQty: number } | null;
  /** False for a product without sizes or colours (one hidden option). */
  hasOptions: boolean;
  variants: StoreVariant[];
  /** Lowest price across options, in kobo. */
  price: number;
  hasPriceRange: boolean;
  soldOut: boolean;
};

const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);

/** Finds a store by its address. Returns null for an unknown or invalid address. */
export async function getStoreBySubdomain(subdomain: string): Promise<StoreInfo | null> {
  const parsed = subdomainSchema.safeParse(subdomain);
  if (!parsed.success) return null;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        subdomain: schema.businesses.subdomain,
        whatsappNumber: schema.businesses.whatsappNumber,
        logo: schema.brandKits.logo,
        primaryColour: schema.brandKits.primaryColour,
        accentColour: schema.brandKits.accentColour,
        font: schema.brandKits.font,
        description: schema.brandKits.description,
      })
      .from(schema.businesses)
      .leftJoin(schema.brandKits, eq(schema.brandKits.businessId, schema.businesses.id))
      .where(eq(schema.businesses.subdomain, parsed.data))
      .limit(1);
    if (!row) return null;
    const [chat] = await tx
      .select({ key: schema.channelConnections.externalAccountId })
      .from(schema.channelConnections)
      .where(
        and(
          eq(schema.channelConnections.businessId, row.id),
          eq(schema.channelConnections.channel, 'web'),
          eq(schema.channelConnections.status, 'connected'),
        ),
      )
      .limit(1);
    return {
      webChatKey: chat?.key ?? null,
      businessId: row.id,
      name: row.name,
      subdomain: row.subdomain,
      whatsappNumber: row.whatsappNumber,
      brand: {
        logo: row.logo ?? null,
        primaryColour: row.primaryColour ?? BRAND_KIT_DEFAULTS.primaryColour,
        accentColour: row.accentColour ?? BRAND_KIT_DEFAULTS.accentColour,
        font: row.font ?? BRAND_KIT_DEFAULTS.font,
        description: row.description ?? BRAND_KIT_DEFAULTS.description,
      },
    };
  });
}

const p = schema.products;
const v = schema.productVariants;
const visible = and(eq(p.isActive, true), isNull(p.archivedAt));

async function productCards(
  tx: Tx,
  where: SQL | undefined,
  order: SQL[],
  limit: number,
  offset = 0,
): Promise<StoreProductCard[]> {
  const price = sql<number>`coalesce(${v.priceOverride}, ${p.retailPrice})`;
  const rows = await tx
    .select({
      id: p.id,
      name: p.name,
      photos: p.photos,
      minPrice: sql<number>`min(${price})::int`,
      maxPrice: sql<number>`max(${price})::int`,
      totalStock: sql<number>`coalesce(sum(${v.stock}), 0)::int`,
    })
    .from(p)
    .innerJoin(v, and(eq(v.productId, p.id), isNull(v.archivedAt)))
    .where(and(visible, where))
    .groupBy(p.id)
    .orderBy(...order, asc(p.id))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    photo: r.photos[0] ?? null,
    price: r.minPrice,
    hasPriceRange: r.minPrice !== r.maxPrice,
    soldOut: r.totalStock <= 0,
  }));
}

/** Store home: featured products (or the newest), categories and the product count. */
export async function getStoreHome(businessId: string): Promise<StoreHome> {
  const id = z.uuid().parse(businessId);
  return withTenant(id, async (tx) => {
    let featured = await productCards(
      tx,
      eq(p.isFeatured, true),
      [desc(p.updatedAt)],
      FEATURED_LIMIT,
    );
    const featuredIsPicked = featured.length > 0;
    if (!featuredIsPicked) {
      featured = await productCards(tx, undefined, [desc(p.createdAt)], FEATURED_LIMIT);
    }
    const categories = await tx
      .select({ name: sql<string>`${p.category}`, productCount: sql<number>`count(*)::int` })
      .from(p)
      .where(and(visible, isNotNull(p.category)))
      .groupBy(p.category)
      .orderBy(asc(p.category));
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(p)
      .where(visible);
    return { featured, featuredIsPicked, categories, productCount: count?.n ?? 0 };
  });
}

export const storeProductListFilter = z.object({
  category: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).max(1000).catch(1).default(1),
});

/** All products (or one category), newest first, a page at a time. */
export async function listStoreProducts(
  businessId: string,
  filter: z.input<typeof storeProductListFilter> = {},
): Promise<{ products: StoreProductCard[]; page: number; hasMore: boolean }> {
  const id = z.uuid().parse(businessId);
  const f = storeProductListFilter.parse(filter);
  return withTenant(id, async (tx) => {
    const rows = await productCards(
      tx,
      f.category ? eq(p.category, f.category) : undefined,
      [desc(p.createdAt)],
      STORE_PAGE_SIZE + 1,
      (f.page - 1) * STORE_PAGE_SIZE,
    );
    return {
      products: rows.slice(0, STORE_PAGE_SIZE),
      page: f.page,
      hasMore: rows.length > STORE_PAGE_SIZE,
    };
  });
}

/** One product with its options, or null when it does not exist, is hidden or archived. */
export async function getStoreProduct(
  businessId: string,
  productId: string,
): Promise<StoreProduct | null> {
  const id = z.uuid().parse(businessId);
  const parsedProduct = z.uuid().safeParse(productId);
  if (!parsedProduct.success) return null;
  return withTenant(id, async (tx) => {
    const [product] = await tx
      .select()
      .from(p)
      .where(and(eq(p.id, parsedProduct.data), visible))
      .limit(1);
    if (!product) return null;
    const rows = await tx
      .select()
      .from(v)
      .where(and(eq(v.productId, product.id), isNull(v.archivedAt)))
      .orderBy(asc(v.position), asc(v.createdAt));
    if (rows.length === 0) return null;
    const variants: StoreVariant[] = rows.map((row) => ({
      id: row.id,
      size: row.size,
      colour: row.colour,
      label: row.isDefault ? '' : variantLabel(row),
      price: row.priceOverride ?? product.retailPrice,
      stock: storeStockStatus(row.stock, product.lowStockThreshold),
    }));
    const prices = variants.map((x) => x.price);
    const price = Math.min(...prices);
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category,
      photos: product.photos,
      wholesale:
        product.wholesalePrice !== null && product.wholesaleMinQty !== null
          ? { price: product.wholesalePrice, minQty: product.wholesaleMinQty }
          : null,
      hasOptions: rows.some((row) => !row.isDefault),
      variants,
      price,
      hasPriceRange: price !== Math.max(...prices),
      soldOut: variants.every((x) => x.stock.state === 'sold_out'),
    };
  });
}
