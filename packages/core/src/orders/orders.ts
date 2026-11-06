import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { applyStockChange } from '../catalog/stock';
import { variantLabel } from '../catalog/rules';
import { findOrCreateCustomerInTx, findOrCreateCustomerInput } from '../customers/customers';
import { recordEvent, userActor, type EventActorRef } from '../events/events';
import { requireMember, type ActorContext } from '../members/access';
import { recordManualPayment } from '../payments/payments';
import { CoreError, isCoreError } from '../shared/errors';
import {
  canCancelOrder,
  canMoveOrder,
  ORDER_STATUS_LABELS,
  PAYMENT_METHODS,
  unitPriceFor,
} from './rules';

const EDITORS = ['owner', 'staff'] as const;
const MAX_ITEMS = 50;

export const createOrderInput = z
  .object({
    customer: z.union([z.object({ id: z.uuid() }), findOrCreateCustomerInput]),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          quantity: z.number().int().min(1, 'Quantity must be at least 1.').max(10_000),
        }),
      )
      .min(1, 'Add at least one item.')
      .max(MAX_ITEMS),
    fulfilment: z.enum(schema.fulfilmentMethods),
    deliveryZoneId: z.uuid().nullish(),
    deliveryAddress: z.string().trim().max(300).default(''),
    discount: z.number().int().min(0).max(1_000_000_000).default(0),
    notes: z.string().trim().max(1000).default(''),
    channel: z.enum(schema.orderChannels).default('manual'),
  })
  .superRefine((v, ctx) => {
    if (v.fulfilment === 'delivery' && !v.deliveryZoneId) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryZoneId'],
        message: 'Choose a delivery area.',
      });
    }
  });
export type CreateOrderInput = z.input<typeof createOrderInput>;

export type CreateOrderOptions = {
  /** Allow hidden (inactive) products. True for owner-recorded orders; the assistant never sets it. */
  allowHiddenProducts?: boolean;
};

export type OrderDetail = {
  order: schema.Order;
  items: schema.OrderItem[];
  customer: Pick<schema.Customer, 'id' | 'name' | 'phone' | 'address'>;
};

async function loadOrder(tx: Tx, orderId: string): Promise<OrderDetail | null> {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .limit(1);
  if (!order) return null;
  const items = await tx
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .orderBy(asc(schema.orderItems.position));
  const [customer] = await tx
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      phone: schema.customers.phone,
      address: schema.customers.address,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, order.customerId))
    .limit(1);
  return { order, items, customer: customer! };
}

/**
 * Creates an order inside a tenant transaction: prices come from the catalog (wholesale
 * applies by quantity), stock is reserved, the customer is found or created, and
 * `order.created` is recorded. Used by the dashboard now and by the assistant later.
 */
export async function createOrderInTx(
  tx: Tx,
  businessId: string,
  input: CreateOrderInput,
  actor: EventActorRef,
  options: CreateOrderOptions = {},
): Promise<OrderDetail> {
  const data = createOrderInput.parse(input);

  // Customer
  let customer: schema.Customer;
  if ('id' in data.customer) {
    const [found] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, data.customer.id))
      .limit(1);
    if (!found) throw new CoreError('not_found', 'This customer no longer exists.', 'customer');
    customer = found;
  } else {
    ({ customer } = await findOrCreateCustomerInTx(tx, businessId, data.customer, actor));
  }

  // Delivery
  let deliveryFee = 0;
  let deliveryZoneName = '';
  let deliveryAddress = '';
  let deliveryZoneId: string | null = null;
  if (data.fulfilment === 'delivery') {
    const [zone] = await tx
      .select()
      .from(schema.deliveryZones)
      .where(
        and(
          eq(schema.deliveryZones.id, data.deliveryZoneId!),
          isNull(schema.deliveryZones.archivedAt),
          eq(schema.deliveryZones.isActive, true),
        ),
      )
      .limit(1);
    if (!zone)
      throw new CoreError('validation', 'Choose a delivery area from your list.', 'deliveryZoneId');
    deliveryAddress = data.deliveryAddress || customer.address;
    if (deliveryAddress.length < 5) {
      throw new CoreError('validation', 'Enter the delivery address.', 'deliveryAddress');
    }
    deliveryFee = zone.fee;
    deliveryZoneName = zone.name;
    deliveryZoneId = zone.id;
  }

  // Items: merge repeated options, then price each line from the catalog.
  const quantities = new Map<string, number>();
  for (const item of data.items) {
    quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
  }
  const variantIds = [...quantities.keys()];
  const rows = await tx
    .select({ variant: schema.productVariants, product: schema.products })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(
      and(
        inArray(schema.productVariants.id, variantIds),
        isNull(schema.productVariants.archivedAt),
        isNull(schema.products.archivedAt),
      ),
    );
  const byVariant = new Map(rows.map((r) => [r.variant.id, r]));
  const lines = variantIds.map((variantId, position) => {
    const row = byVariant.get(variantId);
    if (!row || (!row.product.isActive && !options.allowHiddenProducts)) {
      throw new CoreError('not_found', 'One of the items is no longer available.', 'items');
    }
    const quantity = quantities.get(variantId)!;
    const { unitPrice, isWholesale } = unitPriceFor(row.product, row.variant, quantity);
    return {
      variantId,
      productId: row.product.id,
      productName: row.product.name,
      variantLabel: row.variant.isDefault ? '' : variantLabel(row.variant),
      quantity,
      unitPrice,
      isWholesale,
      lineTotal: unitPrice * quantity,
      position,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (data.discount > subtotal + deliveryFee) {
    throw new CoreError('validation', 'The discount is bigger than the order total.', 'discount');
  }
  const total = subtotal + deliveryFee - data.discount;

  // Next order number for this business (the row lock keeps numbers unique and in order).
  const [counter] = await tx
    .update(schema.businesses)
    .set({ lastOrderNumber: sql`${schema.businesses.lastOrderNumber} + 1` })
    .where(eq(schema.businesses.id, businessId))
    .returning({ number: schema.businesses.lastOrderNumber });
  if (!counter) throw new Error('Business row not found for order number');

  const [order] = await tx
    .insert(schema.orders)
    .values({
      businessId,
      orderNumber: counter.number,
      customerId: customer.id,
      channel: data.channel,
      fulfilment: data.fulfilment,
      deliveryZoneId,
      deliveryZoneName,
      deliveryAddress,
      subtotal,
      deliveryFee,
      discount: data.discount,
      total,
      notes: data.notes,
      createdBy: actor.type === 'user' ? (actor.id ?? null) : null,
    })
    .returning();
  await tx
    .insert(schema.orderItems)
    .values(lines.map((l) => ({ businessId, orderId: order!.id, ...l })));

  // Reserve stock (fails the whole order if anything is short).
  for (const line of lines) {
    try {
      await applyStockChange(
        tx,
        businessId,
        {
          variantId: line.variantId,
          change: -line.quantity,
          reason: 'sale',
          note: `Order #${order!.orderNumber}`,
        },
        actor.type === 'user' ? (actor.id ?? null) : null,
      );
    } catch (error) {
      if (isCoreError(error) && error.code === 'conflict') {
        const label = [line.productName, line.variantLabel].filter(Boolean).join(' – ');
        throw new CoreError('conflict', `${label}: ${error.message}`, 'items');
      }
      throw error;
    }
  }

  // Remember the delivery details on the customer for next time.
  if (data.fulfilment === 'delivery' && (!customer.address || !customer.deliveryZoneId)) {
    await tx
      .update(schema.customers)
      .set({
        address: customer.address || deliveryAddress,
        deliveryZoneId: customer.deliveryZoneId ?? deliveryZoneId,
      })
      .where(eq(schema.customers.id, customer.id));
  }

  await recordEvent(tx, businessId, {
    type: 'order.created',
    actor,
    orderId: order!.id,
    customerId: customer.id,
    payload: {
      orderNumber: order!.orderNumber,
      total,
      itemCount: lines.length,
      channel: data.channel,
    },
  });
  return (await loadOrder(tx, order!.id))!;
}

/** Owner or staff records an order (e.g. one agreed on the phone). */
export async function createOrder(
  actor: ActorContext,
  input: CreateOrderInput,
): Promise<OrderDetail> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    return createOrderInTx(tx, actor.businessId, input, userActor(actor), {
      allowHiddenProducts: true,
    });
  });
}

async function lockOrder(tx: Tx, orderId: string): Promise<schema.Order> {
  const [order] = await tx
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .for('update')
    .limit(1);
  if (!order) throw new CoreError('not_found', 'This order no longer exists.');
  return order;
}

function refuseMove(from: schema.OrderStatus, to: schema.OrderStatus): never {
  throw new CoreError(
    'conflict',
    `This order is "${ORDER_STATUS_LABELS[from]}", so it can't be marked "${ORDER_STATUS_LABELS[to]}".`,
  );
}

const statusTimestamps: Partial<Record<schema.OrderStatus, keyof schema.Order>> = {
  dispatched: 'dispatchedAt',
  delivered: 'deliveredAt',
};

/**
 * Moves an order along: awaiting payment, dispatched, delivered.
 * Use `markOrderPaid` to record payment and `cancelOrder` to cancel.
 */
export async function updateOrderStatus(
  actor: ActorContext,
  orderId: string,
  to: 'awaiting_payment' | 'dispatched' | 'delivered',
): Promise<OrderDetail> {
  const id = z.uuid().parse(orderId);
  const target = z.enum(['awaiting_payment', 'dispatched', 'delivered']).parse(to);
  return withTenant(actor.businessId, async (tx) => {
    // Riders update delivery progress too.
    await requireMember(
      tx,
      actor,
      target === 'awaiting_payment' ? EDITORS : ['owner', 'staff', 'rider'],
    );
    const order = await lockOrder(tx, id);
    if (!canMoveOrder(order.status, target)) refuseMove(order.status, target);
    if (target === 'dispatched' && order.fulfilment === 'pickup') {
      throw new CoreError(
        'conflict',
        'This is a pickup order. Mark it delivered when the customer collects it.',
      );
    }
    const stamp = statusTimestamps[target];
    await tx
      .update(schema.orders)
      .set({ status: target, ...(stamp ? { [stamp]: new Date() } : {}) })
      .where(eq(schema.orders.id, id));
    await recordEvent(tx, actor.businessId, {
      type: 'order.status_changed',
      actor: userActor(actor),
      orderId: id,
      customerId: order.customerId,
      payload: { orderNumber: order.orderNumber, from: order.status, to: target },
    });
    return (await loadOrder(tx, id))!;
  });
}

export const markOrderPaidInput = z.object({
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(200).default(''),
});

/**
 * Records that the full amount was received outside Fulcra (cash, a transfer the owner
 * checked, POS). Automatic payment confirmation arrives with Paystack (P1).
 */
export async function markOrderPaid(
  actor: ActorContext,
  orderId: string,
  input: z.input<typeof markOrderPaidInput>,
): Promise<OrderDetail> {
  const id = z.uuid().parse(orderId);
  const data = markOrderPaidInput.parse(input);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const order = await lockOrder(tx, id);
    if (!canMoveOrder(order.status, 'paid')) refuseMove(order.status, 'paid');
    await tx
      .update(schema.orders)
      .set({
        status: 'paid',
        amountPaid: order.total,
        paymentMethod: data.method,
        paidAt: new Date(),
      })
      .where(eq(schema.orders.id, id));
    if (order.total > 0) {
      await recordManualPayment(tx, actor.businessId, {
        orderId: id,
        amount: order.total,
        method: data.method,
        note: data.note,
        createdBy: actor.userId,
      });
    }
    await recordEvent(tx, actor.businessId, {
      type: 'order.paid',
      actor: userActor(actor),
      orderId: id,
      customerId: order.customerId,
      payload: {
        orderNumber: order.orderNumber,
        amount: order.total,
        method: data.method,
        note: data.note,
        manual: true,
      },
    });
    return (await loadOrder(tx, id))!;
  });
}

/** Cancels an order that has not been dispatched and puts its stock back. */
export async function cancelOrder(
  actor: ActorContext,
  orderId: string,
  input: { reason?: string } = {},
): Promise<OrderDetail> {
  const id = z.uuid().parse(orderId);
  const reason = z.string().trim().max(300).default('').parse(input.reason);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const order = await lockOrder(tx, id);
    if (!canCancelOrder(order.status)) {
      throw new CoreError(
        'conflict',
        order.status === 'cancelled'
          ? 'This order is already cancelled.'
          : 'Orders that have left can no longer be cancelled.',
      );
    }
    const items = await tx
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id));
    for (const item of items) {
      const [variant] = await tx
        .select({ archivedAt: schema.productVariants.archivedAt })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.id, item.variantId))
        .limit(1);
      // An option removed since the order was placed has nowhere to return stock to.
      if (variant && !variant.archivedAt) {
        await applyStockChange(
          tx,
          actor.businessId,
          {
            variantId: item.variantId,
            change: item.quantity,
            reason: 'cancellation',
            note: `Order #${order.orderNumber} cancelled`,
          },
          actor.userId,
        );
      }
    }
    await tx
      .update(schema.orders)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason })
      .where(eq(schema.orders.id, id));
    await recordEvent(tx, actor.businessId, {
      type: 'order.cancelled',
      actor: userActor(actor),
      orderId: id,
      customerId: order.customerId,
      payload: {
        orderNumber: order.orderNumber,
        from: order.status,
        reason,
        wasPaid: order.amountPaid > 0,
      },
    });
    return (await loadOrder(tx, id))!;
  });
}

export async function getOrder(actor: ActorContext, orderId: string): Promise<OrderDetail> {
  const id = z.uuid().parse(orderId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const result = await loadOrder(tx, id);
    if (!result) throw new CoreError('not_found', 'This order no longer exists.');
    return result;
  });
}

export const orderListFilter = z.object({
  status: z.enum(['all', 'open', ...schema.orderStatuses]).default('all'),
  /** Order number (e.g. "1023" or "#1023"), customer name or phone. */
  search: z.string().trim().max(100).optional(),
});

export type OrderListItem = Pick<
  schema.Order,
  'id' | 'orderNumber' | 'status' | 'total' | 'fulfilment' | 'channel' | 'createdAt'
> & { customerName: string; customerPhone: string | null; itemCount: number };

const OPEN_STATUSES = ['new', 'awaiting_payment', 'paid', 'dispatched'] as const;

/** Orders, newest first. "open" means not yet delivered or cancelled. */
export async function listOrders(
  actor: ActorContext,
  filter: z.input<typeof orderListFilter> = {},
): Promise<OrderListItem[]> {
  const f = orderListFilter.parse(filter);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const o = schema.orders;
    const c = schema.customers;
    const conditions: SQL[] = [];
    if (f.status === 'open') conditions.push(inArray(o.status, [...OPEN_STATUSES]));
    else if (f.status !== 'all') conditions.push(eq(o.status, f.status));
    if (f.search) {
      const number = f.search.replace(/^#/, '');
      const like = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`;
      const digits = f.search.replace(/\D/g, '').replace(/^0/, '');
      const match = or(
        /^\d{1,9}$/.test(number) ? eq(o.orderNumber, Number(number)) : undefined,
        ilike(c.name, like),
        digits.length >= 4 ? ilike(c.phone, `%${digits}%`) : undefined,
      );
      if (match) conditions.push(match);
    }
    return tx
      .select({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        fulfilment: o.fulfilment,
        channel: o.channel,
        createdAt: o.createdAt,
        customerName: c.name,
        customerPhone: c.phone,
        itemCount: sql<number>`(select coalesce(sum(${schema.orderItems.quantity}), 0)::int from ${schema.orderItems} where ${schema.orderItems.orderId} = ${o.id})`,
      })
      .from(o)
      .innerJoin(c, eq(c.id, o.customerId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(o.createdAt))
      .limit(500);
  });
}

/** Number of orders per status, for tabs and the dashboard. */
export async function countOrdersByStatus(
  actor: ActorContext,
): Promise<Record<schema.OrderStatus, number>> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const rows = await tx
      .select({ status: schema.orders.status, count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .groupBy(schema.orders.status);
    const counts = Object.fromEntries(schema.orderStatuses.map((s) => [s, 0])) as Record<
      schema.OrderStatus,
      number
    >;
    for (const r of rows) counts[r.status] = r.count;
    return counts;
  });
}
