import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isOwnImagePath } from '../media/images';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError, isUniqueViolation } from '../shared/errors';
import { DEFAULT_LOW_STOCK_THRESHOLD, MAX_PRODUCT_PHOTOS, MAX_VARIANTS } from './rules';
import { applyStockChange } from './stock';

const EDITORS = ['owner', 'staff'] as const;
const MAX_KOBO = 10_000_000_000; // ₦100,000,000

const kobo = z
  .number({ message: 'Enter an amount.' })
  .int('Enter an amount in kobo.')
  .min(0, 'Amounts cannot be negative.')
  .max(MAX_KOBO, 'This amount is too large.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const storedImage = z.object({
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const variantInput = z.object({
  /** Present when editing an existing option. */
  id: z.uuid().optional(),
  size: optionalText(40),
  colour: optionalText(40),
  sku: optionalText(60),
  stock: z
    .number()
    .int('Stock must be a whole number.')
    .min(0, 'Stock cannot be negative.')
    .max(1_000_000),
  priceOverride: kobo.nullish().transform((v) => v ?? null),
});

const options = z.discriminatedUnion('kind', [
  /** No sizes or colours: one hidden default option holds the stock. */
  z.object({
    kind: z.literal('simple'),
    stock: variantInput.shape.stock,
    sku: optionalText(60),
  }),
  z.object({
    kind: z.literal('variants'),
    variants: z.array(variantInput).min(1, 'Add at least one size or colour.').max(MAX_VARIANTS),
  }),
]);

export const productInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Enter the product name.')
      .max(120, 'Keep the name under 120 characters.'),
    description: z
      .string()
      .trim()
      .max(2000, 'Keep the description under 2,000 characters.')
      .default(''),
    category: optionalText(60),
    photos: z
      .array(storedImage)
      .max(MAX_PRODUCT_PHOTOS, `Add up to ${MAX_PRODUCT_PHOTOS} photos.`)
      .default([]),
    retailPrice: kobo.min(1, 'Enter the price.'),
    wholesalePrice: kobo.nullish().transform((v) => v ?? null),
    wholesaleMinQty: z
      .number()
      .int()
      .min(2, 'Wholesale starts from at least 2 items.')
      .max(100_000)
      .nullish()
      .transform((v) => v ?? null),
    minPrice: kobo.nullish().transform((v) => v ?? null),
    lowStockThreshold: z.number().int().min(0).max(100_000).default(DEFAULT_LOW_STOCK_THRESHOLD),
    isActive: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    options,
  })
  .superRefine((p, ctx) => {
    if ((p.wholesalePrice === null) !== (p.wholesaleMinQty === null)) {
      ctx.addIssue({
        code: 'custom',
        path: [p.wholesalePrice === null ? 'wholesalePrice' : 'wholesaleMinQty'],
        message: 'Enter both the wholesale price and the minimum quantity, or neither.',
      });
    }
    if (p.wholesalePrice !== null && p.wholesalePrice > p.retailPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['wholesalePrice'],
        message: 'Wholesale price should not be higher than the retail price.',
      });
    }
    if (p.minPrice !== null && p.minPrice > p.retailPrice) {
      ctx.addIssue({
        code: 'custom',
        path: ['minPrice'],
        message: 'Lowest price should not be higher than the retail price.',
      });
    }
    if (p.options.kind === 'variants') {
      const seenOptions = new Set<string>();
      const seenSkus = new Set<string>();
      p.options.variants.forEach((v, i) => {
        if (!v.size && !v.colour) {
          ctx.addIssue({
            code: 'custom',
            path: ['options', 'variants', i, 'size'],
            message: 'Enter a size or a colour.',
          });
        }
        const key = `${v.size?.toLowerCase() ?? ''}|${v.colour?.toLowerCase() ?? ''}`;
        if (seenOptions.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['options', 'variants', i, 'size'],
            message: 'This size and colour is listed twice.',
          });
        }
        seenOptions.add(key);
        if (v.sku) {
          if (seenSkus.has(v.sku.toLowerCase())) {
            ctx.addIssue({
              code: 'custom',
              path: ['options', 'variants', i, 'sku'],
              message: 'This SKU is used twice.',
            });
          }
          seenSkus.add(v.sku.toLowerCase());
        }
      });
    }
  });

export type ProductInput = z.input<typeof productInput>;
type ParsedProduct = z.output<typeof productInput>;

export type ProductWithVariants = {
  product: schema.Product;
  variants: schema.ProductVariant[];
};

type DesiredVariant = {
  id?: string | undefined;
  size: string | null;
  colour: string | null;
  sku: string | null;
  stock: number;
  priceOverride: number | null;
  isDefault: boolean;
};

function desiredVariants(data: ParsedProduct): DesiredVariant[] {
  if (data.options.kind === 'simple') {
    return [
      {
        size: null,
        colour: null,
        sku: data.options.sku,
        stock: data.options.stock,
        priceOverride: null,
        isDefault: true,
      },
    ];
  }
  return data.options.variants.map((v) => ({ ...v, isDefault: false }));
}

function productFields(data: ParsedProduct) {
  return {
    name: data.name,
    description: data.description,
    category: data.category,
    photos: data.photos,
    retailPrice: data.retailPrice,
    wholesalePrice: data.wholesalePrice,
    wholesaleMinQty: data.wholesaleMinQty,
    minPrice: data.minPrice,
    lowStockThreshold: data.lowStockThreshold,
    isActive: data.isActive,
    isFeatured: data.isFeatured,
  };
}

function checkPhotos(businessId: string, data: ParsedProduct) {
  if (data.photos.some((photo) => !isOwnImagePath(businessId, photo.path))) {
    throw new CoreError(
      'validation',
      'One of the photos could not be found. Please upload it again.',
      'photos',
    );
  }
}

function rethrowUnique(error: unknown): never {
  if (isUniqueViolation(error, 'product_variants_sku_unique')) {
    throw new CoreError('conflict', 'This SKU is already used by another product.', 'sku');
  }
  if (isUniqueViolation(error, 'product_variants_options_unique')) {
    throw new CoreError('conflict', 'This size and colour is listed twice.', 'options');
  }
  throw error;
}

async function insertVariants(
  tx: Tx,
  actor: ActorContext,
  productId: string,
  variants: (DesiredVariant & { position: number })[],
) {
  if (variants.length === 0) return;
  const rows = await tx
    .insert(schema.productVariants)
    .values(
      variants.map((v) => ({
        businessId: actor.businessId,
        productId,
        size: v.size,
        colour: v.colour,
        sku: v.sku,
        stock: v.stock,
        priceOverride: v.priceOverride,
        isDefault: v.isDefault,
        position: v.position,
      })),
    )
    .returning({ id: schema.productVariants.id, stock: schema.productVariants.stock });
  const opening = rows.filter((r) => r.stock > 0);
  if (opening.length > 0) {
    await tx.insert(schema.stockMovements).values(
      opening.map((r) => ({
        businessId: actor.businessId,
        variantId: r.id,
        change: r.stock,
        stockAfter: r.stock,
        reason: 'initial' as const,
        createdBy: actor.userId,
      })),
    );
  }
}

async function loadProduct(tx: Tx, productId: string): Promise<ProductWithVariants | null> {
  const [product] = await tx
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.id, productId), isNull(schema.products.archivedAt)))
    .limit(1);
  if (!product) return null;
  const variants = await tx
    .select()
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.productId, productId),
        isNull(schema.productVariants.archivedAt),
      ),
    )
    .orderBy(asc(schema.productVariants.position), asc(schema.productVariants.createdAt));
  return { product, variants };
}

/** Adds a product with its options and opening stock. Owner or staff. */
export async function createProduct(
  actor: ActorContext,
  input: ProductInput,
): Promise<ProductWithVariants> {
  const data = productInput.parse(input);
  checkPhotos(actor.businessId, data);
  try {
    return await withTenant(actor.businessId, async (tx) => {
      await requireMember(tx, actor, EDITORS);
      const [product] = await tx
        .insert(schema.products)
        .values({ businessId: actor.businessId, ...productFields(data) })
        .returning();
      if (!product) throw new Error('Product insert returned no row');
      await insertVariants(
        tx,
        actor,
        product.id,
        desiredVariants(data).map((v, position) => ({ ...v, position })),
      );
      return (await loadProduct(tx, product.id))!;
    });
  } catch (error) {
    rethrowUnique(error);
  }
}

/**
 * Saves the product form. Options are matched by id: kept ones are updated (stock
 * differences are recorded as adjustments), missing ones are archived, new ones added.
 */
export async function updateProduct(
  actor: ActorContext,
  productId: string,
  input: ProductInput,
): Promise<ProductWithVariants> {
  const id = z.uuid().parse(productId);
  const data = productInput.parse(input);
  checkPhotos(actor.businessId, data);
  try {
    return await withTenant(actor.businessId, async (tx) => {
      await requireMember(tx, actor, EDITORS);
      const current = await loadProduct(tx, id);
      if (!current) throw new CoreError('not_found', 'This product no longer exists.');

      await tx.update(schema.products).set(productFields(data)).where(eq(schema.products.id, id));

      const existing = new Map(current.variants.map((v) => [v.id, v]));
      const desired = desiredVariants(data).map((v, position) => ({ ...v, position }));
      // A simple product keeps its default option (and its stock history).
      if (data.options.kind === 'simple') {
        const currentDefault = current.variants.find((v) => v.isDefault);
        if (currentDefault) desired[0]!.id = currentDefault.id;
      }
      const kept = desired.filter((v) => v.id && existing.has(v.id));
      const added = desired.filter((v) => !v.id || !existing.has(v.id));
      const keptIds = new Set(kept.map((v) => v.id));
      const removed = current.variants.filter((v) => !keptIds.has(v.id));

      if (removed.length > 0) {
        await tx
          .update(schema.productVariants)
          .set({ archivedAt: new Date() })
          .where(
            inArray(
              schema.productVariants.id,
              removed.map((v) => v.id),
            ),
          );
      }
      for (const v of kept) {
        const before = existing.get(v.id!)!;
        await tx
          .update(schema.productVariants)
          .set({
            size: v.size,
            colour: v.colour,
            sku: v.sku,
            priceOverride: v.priceOverride,
            isDefault: v.isDefault,
            position: v.position,
          })
          .where(eq(schema.productVariants.id, before.id));
        if (v.stock !== before.stock) {
          await applyStockChange(
            tx,
            actor.businessId,
            {
              variantId: before.id,
              change: v.stock - before.stock,
              reason: 'adjustment',
              note: 'Changed in product form',
            },
            actor.userId,
          );
        }
      }
      await insertVariants(tx, actor, id, added);
      return (await loadProduct(tx, id))!;
    });
  } catch (error) {
    rethrowUnique(error);
  }
}

export async function getProduct(
  actor: ActorContext,
  productId: string,
): Promise<ProductWithVariants> {
  const id = z.uuid().parse(productId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const result = await loadProduct(tx, id);
    if (!result) throw new CoreError('not_found', 'This product no longer exists.');
    return result;
  });
}

/** Shows or hides a product (hidden products are not offered to customers). */
export async function setProductActive(
  actor: ActorContext,
  productId: string,
  isActive: boolean,
): Promise<void> {
  const id = z.uuid().parse(productId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const updated = await tx
      .update(schema.products)
      .set({ isActive })
      .where(and(eq(schema.products.id, id), isNull(schema.products.archivedAt)))
      .returning({ id: schema.products.id });
    if (updated.length === 0) throw new CoreError('not_found', 'This product no longer exists.');
  });
}

/** "Delete" in the app: archives the product so past orders and receipts keep working. */
export async function archiveProduct(actor: ActorContext, productId: string): Promise<void> {
  const id = z.uuid().parse(productId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    await tx
      .update(schema.products)
      .set({ archivedAt: new Date(), isActive: false })
      .where(and(eq(schema.products.id, id), isNull(schema.products.archivedAt)));
  });
}

/** Copies a product (photos, prices, options) with zero stock and no SKUs. */
export async function duplicateProduct(
  actor: ActorContext,
  productId: string,
): Promise<ProductWithVariants> {
  const id = z.uuid().parse(productId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const source = await loadProduct(tx, id);
    if (!source) throw new CoreError('not_found', 'This product no longer exists.');
    const { product } = source;
    const [copy] = await tx
      .insert(schema.products)
      .values({
        businessId: actor.businessId,
        name: `${product.name} (copy)`.slice(0, 120),
        description: product.description,
        category: product.category,
        photos: product.photos,
        retailPrice: product.retailPrice,
        wholesalePrice: product.wholesalePrice,
        wholesaleMinQty: product.wholesaleMinQty,
        minPrice: product.minPrice,
        lowStockThreshold: product.lowStockThreshold,
        isActive: product.isActive,
      })
      .returning();
    if (!copy) throw new Error('Product insert returned no row');
    await insertVariants(
      tx,
      actor,
      copy.id,
      source.variants.map((v, position) => ({
        size: v.size,
        colour: v.colour,
        sku: null,
        stock: 0,
        priceOverride: v.priceOverride,
        isDefault: v.isDefault,
        position,
      })),
    );
    return (await loadProduct(tx, copy.id))!;
  });
}

export const productListFilter = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  show: z.enum(['all', 'low_stock', 'hidden']).default('all'),
});

export type ProductListItem = {
  id: string;
  name: string;
  category: string | null;
  photo: schema.StoredImage | null;
  retailPrice: number;
  isActive: boolean;
  totalStock: number;
  optionCount: number;
  hasOptions: boolean;
  lowStock: boolean;
};

/** The catalog list, newest first. Archived products are never listed. */
export async function listProducts(
  actor: ActorContext,
  filter: z.input<typeof productListFilter> = {},
): Promise<ProductListItem[]> {
  const f = productListFilter.parse(filter);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const p = schema.products;
    const v = schema.productVariants;
    const conditions = [isNull(p.archivedAt)];
    if (f.search) conditions.push(ilike(p.name, `%${f.search.replace(/[\\%_]/g, '\\$&')}%`));
    if (f.category) conditions.push(eq(p.category, f.category));
    if (f.show === 'hidden') conditions.push(eq(p.isActive, false));

    const lowStock = sql<boolean>`coalesce(bool_or(${v.stock} <= ${p.lowStockThreshold}), false)`;
    const rows = await tx
      .select({
        id: p.id,
        name: p.name,
        category: p.category,
        photos: p.photos,
        retailPrice: p.retailPrice,
        isActive: p.isActive,
        totalStock: sql<number>`coalesce(sum(${v.stock}), 0)::int`,
        optionCount: sql<number>`count(${v.id})::int`,
        hasOptions: sql<boolean>`coalesce(bool_or(not ${v.isDefault}), false)`,
        lowStock,
      })
      .from(p)
      .leftJoin(v, and(eq(v.productId, p.id), isNull(v.archivedAt)))
      .where(and(...conditions))
      .groupBy(p.id)
      .having(f.show === 'low_stock' ? lowStock : undefined)
      .orderBy(desc(p.createdAt))
      .limit(500);

    return rows.map(({ photos, ...row }) => ({ ...row, photo: photos[0] ?? null }));
  });
}

/** Categories already used, for suggestions and filters. */
export async function listCategories(actor: ActorContext): Promise<string[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const rows = await tx
      .selectDistinct({ category: schema.products.category })
      .from(schema.products)
      .where(and(isNull(schema.products.archivedAt), isNotNull(schema.products.category)))
      .orderBy(asc(schema.products.category));
    return rows.map((r) => r.category!).filter(Boolean);
  });
}

export type OrderableProduct = {
  id: string;
  name: string;
  isActive: boolean;
  photo: schema.StoredImage | null;
  retailPrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  variants: {
    id: string;
    size: string | null;
    colour: string | null;
    isDefault: boolean;
    stock: number;
    priceOverride: number | null;
  }[];
};

/** Products and their options for the order form (archived ones excluded), A–Z. */
export async function listOrderableProducts(actor: ActorContext): Promise<OrderableProduct[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const p = schema.products;
    const v = schema.productVariants;
    const rows = await tx
      .select({ product: p, variant: v })
      .from(p)
      .innerJoin(v, and(eq(v.productId, p.id), isNull(v.archivedAt)))
      .where(isNull(p.archivedAt))
      .orderBy(asc(p.name), asc(v.position))
      .limit(2000);
    const byProduct = new Map<string, OrderableProduct>();
    for (const { product, variant } of rows) {
      let entry = byProduct.get(product.id);
      if (!entry) {
        entry = {
          id: product.id,
          name: product.name,
          isActive: product.isActive,
          photo: product.photos[0] ?? null,
          retailPrice: product.retailPrice,
          wholesalePrice: product.wholesalePrice,
          wholesaleMinQty: product.wholesaleMinQty,
          variants: [],
        };
        byProduct.set(product.id, entry);
      }
      entry.variants.push({
        id: variant.id,
        size: variant.size,
        colour: variant.colour,
        isDefault: variant.isDefault,
        stock: variant.stock,
        priceOverride: variant.priceOverride,
      });
    }
    return [...byProduct.values()];
  });
}
