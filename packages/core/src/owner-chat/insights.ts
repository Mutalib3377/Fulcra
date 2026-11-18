import { schema, withTenant, type Tx } from '@fulcra/db';
import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import { SALES_PERIODS, SALES_PERIOD_LABELS, type SalesPeriod } from './rules';

/**
 * What the owner can ask their assistant (O1): read-only answers from the business's own data.
 * Owner only. Amounts are kobo (the assistant formats them).
 */
const OWNER = ['owner'] as const;

async function timezoneOf(tx: Tx): Promise<string> {
  const [b] = await tx.select({ tz: schema.businesses.timezone }).from(schema.businesses).limit(1);
  return b?.tz ?? 'Africa/Lagos';
}

/** SQL condition: a timestamp falls in the period, in the business's time zone. */
function inPeriod(column: SQL | AnyColumn, period: SalesPeriod, tz: string, now: Date): SQL {
  const local = sql`(${column} at time zone ${tz})::date`;
  const today = sql`(${now.toISOString()}::timestamptz at time zone ${tz})::date`;
  switch (period) {
    case 'today':
      return sql`${local} = ${today}`;
    case 'yesterday':
      return sql`${local} = ${today} - 1`;
    case 'this_week':
      return sql`${local} >= date_trunc('week', ${today})::date and ${local} <= ${today}`;
    case 'this_month':
      return sql`${local} >= date_trunc('month', ${today})::date and ${local} <= ${today}`;
    case 'last_7_days':
      return sql`${local} > ${today} - 7 and ${local} <= ${today}`;
    case 'last_30_days':
      return sql`${local} > ${today} - 30 and ${local} <= ${today}`;
  }
}

export const salesPeriodInput = z.enum(SALES_PERIODS);

export type SalesSummary = {
  period: SalesPeriod;
  label: string;
  paidOrders: number;
  amount: number;
  unpaidOrders: number;
  unpaidAmount: number;
};

/** Money received in a period (paid orders, by payment date) and what is still unpaid now. */
export async function ownerSalesSummary(
  actor: ActorContext,
  period: SalesPeriod,
  now = new Date(),
): Promise<SalesSummary> {
  const p = salesPeriodInput.parse(period);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const tz = await timezoneOf(tx);
    const o = schema.orders;
    const [paid] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${o.amountPaid}), 0)::int`,
      })
      .from(o)
      .where(and(isNotNull(o.paidAt), ne(o.status, 'cancelled'), inPeriod(o.paidAt, p, tz, now)));
    const [unpaid] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        amount: sql<number>`coalesce(sum(${o.total} - ${o.amountPaid}), 0)::int`,
      })
      .from(o)
      .where(inArray(o.status, ['new', 'awaiting_payment']));
    return {
      period: p,
      label: SALES_PERIOD_LABELS[p],
      paidOrders: paid?.n ?? 0,
      amount: paid?.amount ?? 0,
      unpaidOrders: unpaid?.n ?? 0,
      unpaidAmount: unpaid?.amount ?? 0,
    };
  });
}

export type BestSeller = { productId: string; name: string; quantity: number; amount: number };

/** Products sold most (by quantity) in paid orders of a period. */
export async function ownerBestSellers(
  actor: ActorContext,
  period: SalesPeriod,
  now = new Date(),
): Promise<{ label: string; products: BestSeller[] }> {
  const p = salesPeriodInput.parse(period);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const tz = await timezoneOf(tx);
    const o = schema.orders;
    const i = schema.orderItems;
    const rows = await tx
      .select({
        productId: i.productId,
        name: sql<string>`max(${i.productName})`,
        quantity: sql<number>`sum(${i.quantity})::int`,
        amount: sql<number>`sum(${i.lineTotal})::int`,
      })
      .from(i)
      .innerJoin(o, eq(o.id, i.orderId))
      .where(and(isNotNull(o.paidAt), ne(o.status, 'cancelled'), inPeriod(o.paidAt, p, tz, now)))
      .groupBy(i.productId)
      .orderBy(desc(sql`sum(${i.quantity})`))
      .limit(5);
    return { label: SALES_PERIOD_LABELS[p], products: rows };
  });
}

export const ownerOrdersInput = z.enum(['unpaid', 'to_send', 'open', 'recent']);

export type OwnerOrderLine = {
  orderNumber: number;
  status: schema.OrderStatus;
  customer: string;
  total: number;
  createdAt: Date;
};

/** A short list of orders: unpaid, paid but not sent, all open, or the most recent. */
export async function ownerOrders(
  actor: ActorContext,
  which: z.infer<typeof ownerOrdersInput>,
): Promise<{ orders: OwnerOrderLine[]; total: number }> {
  const w = ownerOrdersInput.parse(which);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const o = schema.orders;
    const statuses: schema.OrderStatus[] | null =
      w === 'unpaid'
        ? ['new', 'awaiting_payment']
        : w === 'to_send'
          ? ['paid']
          : w === 'open'
            ? ['new', 'awaiting_payment', 'paid', 'dispatched']
            : null;
    const where = statuses ? inArray(o.status, statuses) : undefined;
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(o)
      .where(where);
    const rows = await tx
      .select({
        orderNumber: o.orderNumber,
        status: o.status,
        customer: schema.customers.name,
        total: o.total,
        createdAt: o.createdAt,
      })
      .from(o)
      .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
      .where(where)
      .orderBy(desc(o.createdAt))
      .limit(10);
    return { orders: rows, total: count?.n ?? 0 };
  });
}

export type OwnerOrderDetail = {
  orderId: string;
  orderNumber: number;
  status: schema.OrderStatus;
  customer: { name: string; phone: string | null };
  items: { name: string; quantity: number; lineTotal: number }[];
  deliveryFee: number;
  total: number;
  amountPaid: number;
  fulfilment: schema.Order['fulfilment'];
  createdAt: Date;
};

/** One order by its number (e.g. 1042). */
export async function ownerFindOrder(
  actor: ActorContext,
  orderNumber: number,
): Promise<OwnerOrderDetail> {
  const n = z.number().int().positive().parse(orderNumber);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    return loadOrderByNumber(tx, n);
  });
}

export async function loadOrderByNumber(tx: Tx, orderNumber: number): Promise<OwnerOrderDetail> {
  const o = schema.orders;
  const [row] = await tx
    .select({ order: o, customer: schema.customers })
    .from(o)
    .innerJoin(schema.customers, eq(schema.customers.id, o.customerId))
    .where(eq(o.orderNumber, orderNumber))
    .limit(1);
  if (!row) throw new CoreError('not_found', `There is no order #${orderNumber}.`);
  const items = await tx
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, row.order.id));
  return {
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    status: row.order.status,
    customer: { name: row.customer.name, phone: row.customer.phone },
    items: items.map((i) => ({
      name: i.variantLabel ? `${i.productName} (${i.variantLabel})` : i.productName,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    deliveryFee: row.order.deliveryFee,
    total: row.order.total,
    amountPaid: row.order.amountPaid,
    fulfilment: row.order.fulfilment,
    createdAt: row.order.createdAt,
  };
}

export type OwnerProductMatch = {
  productId: string;
  name: string;
  retailPrice: number;
  isActive: boolean;
  options: { variantId: string; label: string; stock: number; price: number }[];
};

/** Products whose name or category matches the words (up to 5), with each option's stock. */
export async function ownerFindProducts(
  actor: ActorContext,
  query: string,
): Promise<OwnerProductMatch[]> {
  const q = z.string().trim().min(1).max(100).parse(query);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, OWNER);
    const p = schema.products;
    const words = q
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 5);
    const terms = words.length ? words : [q];
    const products = await tx
      .select()
      .from(p)
      .where(
        and(
          isNull(p.archivedAt),
          or(...terms.map((w) => or(ilike(p.name, `%${w}%`), ilike(p.category, `%${w}%`)))),
        ),
      )
      .orderBy(desc(p.updatedAt))
      .limit(5);
    if (products.length === 0) return [];
    const variants = await tx
      .select()
      .from(schema.productVariants)
      .where(
        inArray(
          schema.productVariants.productId,
          products.map((x) => x.id),
        ),
      )
      .orderBy(schema.productVariants.position);
    return products.map((product) => ({
      productId: product.id,
      name: product.name,
      retailPrice: product.retailPrice,
      isActive: product.isActive,
      options: variants
        .filter((v) => v.productId === product.id)
        .map((v) => ({
          variantId: v.id,
          label: [v.size, v.colour].filter(Boolean).join(' / ') || 'Standard',
          stock: v.stock,
          price: v.priceOverride ?? product.retailPrice,
        })),
    }));
  });
}
