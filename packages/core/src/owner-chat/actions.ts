import { formatNaira } from '@fulcra/config';
import { schema, withTenant, type Tx } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createProduct, setProductActive, setProductPrice } from '../catalog/products';
import { adjustStock } from '../catalog/stock';
import { cancelOrder, markOrderPaid, updateOrderStatus } from '../orders/orders';
import {
  canCancelOrder,
  canMoveOrder,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '../orders/rules';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import { loadOrderByNumber } from './insights';

/**
 * Changes the owner can ask for in chat (O1). The assistant only *proposes* them: each proposal
 * is checked now, described in plain words, and saved as data. Only the owner's YES runs it,
 * through the same Core services the dashboard uses.
 */
const OWNER = ['owner'] as const;
const naira = z.number().int().min(1).max(100_000_000); // in naira, as the owner says it
const orderNumber = z.number().int().positive();

export const ownerActionInputs = {
  add_product: z.object({
    name: z.string().trim().min(2).max(120),
    priceNaira: naira,
    stock: z.number().int().min(0).max(100_000),
    description: z.string().trim().max(2000).default(''),
    category: z.string().trim().max(60).nullable().default(null),
    /** Use the last photo the owner sent in this chat as the product photo. */
    usePhoto: z.boolean().default(false),
  }),
  set_stock: z.object({ variantId: z.uuid(), stock: z.number().int().min(0).max(100_000) }),
  set_price: z.object({ productId: z.uuid(), priceNaira: naira }),
  set_visibility: z.object({ productId: z.uuid(), visible: z.boolean() }),
  mark_paid: z.object({ orderNumber, method: z.enum(['cash', 'transfer', 'pos', 'other']) }),
  set_order_status: z.object({ orderNumber, status: z.enum(['dispatched', 'delivered']) }),
  cancel_order: z.object({ orderNumber, reason: z.string().trim().max(200).default('') }),
} as const;
export type OwnerActionKind = keyof typeof ownerActionInputs;
export const OWNER_ACTION_KINDS = Object.keys(ownerActionInputs) as OwnerActionKind[];

export type ProposedAction = { kind: OwnerActionKind; params: unknown; summary: string };

async function variantWithProduct(tx: Tx, variantId: string) {
  const [row] = await tx
    .select({ variant: schema.productVariants, product: schema.products })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(eq(schema.productVariants.id, variantId))
    .limit(1);
  if (!row) throw new CoreError('not_found', 'That product option was not found.');
  return row;
}

async function product(tx: Tx, productId: string) {
  const [row] = await tx
    .select()
    .from(schema.products)
    .where(eq(schema.products.id, productId))
    .limit(1);
  if (!row || row.archivedAt) throw new CoreError('not_found', 'That product was not found.');
  return row;
}

const labelOf = (v: schema.ProductVariant) => [v.size, v.colour].filter(Boolean).join(' / ') || '';

/** Checks a change and describes it for the owner's YES. Nothing is changed. */
export async function describeOwnerAction(
  actor: ActorContext,
  kind: OwnerActionKind,
  input: unknown,
  hasPhoto: boolean,
): Promise<ProposedAction> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    switch (kind) {
      case 'add_product': {
        const p = ownerActionInputs.add_product.parse(input);
        const params = { ...p, usePhoto: p.usePhoto && hasPhoto };
        return {
          kind,
          params,
          summary: `Add "${p.name}" at ${formatNaira(p.priceNaira * 100)} with ${p.stock} in stock${params.usePhoto ? ', using the photo you sent' : ''}`,
        };
      }
      case 'set_stock': {
        const p = ownerActionInputs.set_stock.parse(input);
        const { variant, product: prod } = await variantWithProduct(tx, p.variantId);
        const label = labelOf(variant);
        return {
          kind,
          params: p,
          summary: `Set stock of "${prod.name}${label ? ` (${label})` : ''}" from ${variant.stock} to ${p.stock}`,
        };
      }
      case 'set_price': {
        const p = ownerActionInputs.set_price.parse(input);
        const prod = await product(tx, p.productId);
        return {
          kind,
          params: p,
          summary: `Change the price of "${prod.name}" from ${formatNaira(prod.retailPrice)} to ${formatNaira(p.priceNaira * 100)}`,
        };
      }
      case 'set_visibility': {
        const p = ownerActionInputs.set_visibility.parse(input);
        const prod = await product(tx, p.productId);
        return {
          kind,
          params: p,
          summary: p.visible
            ? `Show "${prod.name}" in your store again`
            : `Hide "${prod.name}" from your store`,
        };
      }
      case 'mark_paid': {
        const p = ownerActionInputs.mark_paid.parse(input);
        const order = await loadOrderByNumber(tx, p.orderNumber);
        if (order.amountPaid >= order.total)
          throw new CoreError('conflict', `Order #${p.orderNumber} is already paid.`);
        return {
          kind,
          params: p,
          summary: `Mark order #${p.orderNumber} (${order.customer.name}, ${formatNaira(order.total)}) as paid by ${PAYMENT_METHOD_LABELS[p.method].toLowerCase()}`,
        };
      }
      case 'set_order_status': {
        const p = ownerActionInputs.set_order_status.parse(input);
        const order = await loadOrderByNumber(tx, p.orderNumber);
        // Same rules as the dashboard, checked now so the owner is never asked to confirm
        // something that would fail.
        if (p.status === 'dispatched' && order.fulfilment === 'pickup')
          throw new CoreError(
            'conflict',
            `Order #${p.orderNumber} is a pickup order. Mark it delivered when the customer collects it.`,
          );
        if (!canMoveOrder(order.status, p.status))
          throw new CoreError(
            'conflict',
            `Order #${p.orderNumber} is ${ORDER_STATUS_LABELS[order.status].toLowerCase()}, so it can't be marked ${p.status} now.`,
          );
        return {
          kind,
          params: p,
          summary: `Mark order #${p.orderNumber} (${order.customer.name}) as ${p.status}`,
        };
      }
      case 'cancel_order': {
        const p = ownerActionInputs.cancel_order.parse(input);
        const order = await loadOrderByNumber(tx, p.orderNumber);
        if (!canCancelOrder(order.status))
          throw new CoreError(
            'conflict',
            `Order #${p.orderNumber} is ${ORDER_STATUS_LABELS[order.status].toLowerCase()} and can't be cancelled.`,
          );
        return {
          kind,
          params: p,
          summary: `Cancel order #${p.orderNumber} (${order.customer.name}, ${formatNaira(order.total)})${p.reason ? `: ${p.reason}` : ''}`,
        };
      }
    }
  });
}

/** Runs a confirmed change through the usual Core services. Returns what to tell the owner. */
export async function executeOwnerAction(
  actor: ActorContext,
  action: { kind: string; params: unknown },
  photo: schema.StoredImage | null,
): Promise<string> {
  const kind = action.kind as OwnerActionKind;
  switch (kind) {
    case 'add_product': {
      const p = ownerActionInputs.add_product.parse(action.params);
      const created = await createProduct(actor, {
        name: p.name,
        description: p.description,
        category: p.category ?? undefined,
        retailPrice: p.priceNaira * 100,
        photos: p.usePhoto && photo ? [photo] : [],
        options: { kind: 'simple', stock: p.stock },
      });
      return `Done. "${created.product.name}" is in your catalog at ${formatNaira(created.product.retailPrice)} with ${p.stock} in stock.`;
    }
    case 'set_stock': {
      const p = ownerActionInputs.set_stock.parse(action.params);
      const current = await withTenant(actor.businessId, (tx) =>
        variantWithProduct(tx, p.variantId),
      );
      const change = p.stock - current.variant.stock;
      if (change !== 0)
        await adjustStock(actor, { variantId: p.variantId, change, note: 'From the owner chat' });
      return `Done. "${current.product.name}" now has ${p.stock} in stock.`;
    }
    case 'set_price': {
      const p = ownerActionInputs.set_price.parse(action.params);
      const updated = await setProductPrice(actor, p.productId, p.priceNaira * 100);
      return `Done. "${updated.name}" now costs ${formatNaira(updated.retailPrice)}.`;
    }
    case 'set_visibility': {
      const p = ownerActionInputs.set_visibility.parse(action.params);
      await setProductActive(actor, p.productId, p.visible);
      return p.visible
        ? 'Done. It shows in your store again.'
        : 'Done. It is hidden from your store.';
    }
    case 'mark_paid': {
      const p = ownerActionInputs.mark_paid.parse(action.params);
      const order = await withTenant(actor.businessId, (tx) =>
        loadOrderByNumber(tx, p.orderNumber),
      );
      await markOrderPaid(actor, order.orderId, { method: p.method, note: 'From the owner chat' });
      return `Done. Order #${p.orderNumber} is marked as paid.`;
    }
    case 'set_order_status': {
      const p = ownerActionInputs.set_order_status.parse(action.params);
      const order = await withTenant(actor.businessId, (tx) =>
        loadOrderByNumber(tx, p.orderNumber),
      );
      await updateOrderStatus(actor, order.orderId, p.status);
      return `Done. Order #${p.orderNumber} is marked as ${p.status}.`;
    }
    case 'cancel_order': {
      const p = ownerActionInputs.cancel_order.parse(action.params);
      const order = await withTenant(actor.businessId, (tx) =>
        loadOrderByNumber(tx, p.orderNumber),
      );
      await cancelOrder(actor, order.orderId, { reason: p.reason || undefined });
      return `Done. Order #${p.orderNumber} is cancelled and its stock is back.`;
    }
    default:
      throw new CoreError('validation', 'I could not do that change.');
  }
}
