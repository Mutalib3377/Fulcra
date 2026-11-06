import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { recordEvent } from '../events/events';
import { CoreError } from '../shared/errors';
import { variantLabel } from './rules';

export type StockChange = {
  variantId: string;
  /** Positive to add stock, negative to remove. */
  change: number;
  reason: schema.StockMovementReason;
  note?: string;
};

/**
 * Changes a variant's stock and records the movement, inside an existing tenant
 * transaction. Locks the variant row so concurrent changes cannot oversell.
 * Used by `adjustStock` and, from C3, by order services.
 */
export async function applyStockChange(
  tx: Tx,
  businessId: string,
  input: StockChange,
  createdBy: string | null,
): Promise<{ stock: number }> {
  if (!Number.isInteger(input.change) || input.change === 0) {
    throw new CoreError('validation', 'Enter a whole number that is not zero.', 'change');
  }
  const [variant] = await tx
    .select({
      stock: schema.productVariants.stock,
      size: schema.productVariants.size,
      colour: schema.productVariants.colour,
      productId: schema.products.id,
      productName: schema.products.name,
      threshold: schema.products.lowStockThreshold,
      isActive: schema.products.isActive,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(
      and(
        eq(schema.productVariants.id, input.variantId),
        isNull(schema.productVariants.archivedAt),
      ),
    )
    .for('update', { of: schema.productVariants })
    .limit(1);
  if (!variant) throw new CoreError('not_found', 'This product option no longer exists.');

  const stock = variant.stock + input.change;
  if (stock < 0) {
    throw new CoreError(
      'conflict',
      variant.stock === 0 ? 'This item is out of stock.' : `Only ${variant.stock} left in stock.`,
      'change',
    );
  }

  await tx
    .update(schema.productVariants)
    .set({ stock })
    .where(eq(schema.productVariants.id, input.variantId));
  await tx.insert(schema.stockMovements).values({
    businessId,
    variantId: input.variantId,
    change: input.change,
    stockAfter: stock,
    reason: input.reason,
    note: input.note?.trim().slice(0, 200) ?? '',
    createdBy,
  });

  // Crossing the low-stock level (not every change while already low) raises one event.
  if (variant.isActive && variant.stock > variant.threshold && stock <= variant.threshold) {
    await recordEvent(tx, businessId, {
      type: 'stock.low',
      actor: createdBy ? { type: 'user', id: createdBy } : { type: 'system' },
      payload: {
        productId: variant.productId,
        productName: variant.productName,
        variantId: input.variantId,
        variantLabel: variantLabel(variant),
        stock,
        threshold: variant.threshold,
      },
    });
  }
  return { stock };
}

export const adjustStockInput = z.object({
  variantId: z.uuid(),
  change: z.number().int('Enter a whole number.'),
  note: z.string().trim().max(200).optional(),
});

/** Owner or staff adds or removes stock by hand (e.g. new delivery, damaged items). */
export async function adjustStock(
  actor: ActorContext,
  input: z.input<typeof adjustStockInput>,
): Promise<{ stock: number }> {
  const data = adjustStockInput.parse(input);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    return applyStockChange(tx, actor.businessId, { ...data, reason: 'adjustment' }, actor.userId);
  });
}

export type LowStockItem = {
  productId: string;
  productName: string;
  variantId: string;
  size: string | null;
  colour: string | null;
  isDefault: boolean;
  stock: number;
  threshold: number;
};

/** Options of active products at or below their low-stock level, lowest first. */
export async function listLowStock(actor: ActorContext): Promise<LowStockItem[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    return tx
      .select({
        productId: schema.products.id,
        productName: schema.products.name,
        variantId: schema.productVariants.id,
        size: schema.productVariants.size,
        colour: schema.productVariants.colour,
        isDefault: schema.productVariants.isDefault,
        stock: schema.productVariants.stock,
        threshold: schema.products.lowStockThreshold,
      })
      .from(schema.productVariants)
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(
        and(
          isNull(schema.productVariants.archivedAt),
          isNull(schema.products.archivedAt),
          eq(schema.products.isActive, true),
          lte(schema.productVariants.stock, schema.products.lowStockThreshold),
        ),
      )
      .orderBy(asc(schema.productVariants.stock), asc(schema.products.name));
  });
}

/** Recent stock changes for one product option, newest first. */
export async function listStockMovements(
  actor: ActorContext,
  variantId: string,
  limit = 20,
): Promise<schema.StockMovement[]> {
  const id = z.uuid().parse(variantId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    return tx
      .select()
      .from(schema.stockMovements)
      .where(eq(schema.stockMovements.variantId, id))
      .orderBy(sql`${schema.stockMovements.createdAt} desc`)
      .limit(Math.min(limit, 100));
  });
}
