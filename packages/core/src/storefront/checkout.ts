import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { variantLabel } from '../catalog/rules';
import type { StoredImage } from '../media/images';
import { requireMember, type ActorContext, type StorefrontActor } from '../members/access';
import { cancelOrderInTx, createOrderInTx } from '../orders/orders';
import { unitPriceFor } from '../orders/rules';
import { createPaymentLink } from '../payments/payments';
import { CoreError } from '../shared/errors';
import { normalizePhoneNumber } from '../shared/phone';
import { consumeRateLimit } from '../system/rate-limit';
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY,
  STORE_CHECKOUT_MINUTES,
  type CartLine,
} from './cart-rules';

/**
 * Store checkout (K1, docs/decisions/0025): a shopper adds to cart and pays on the store with
 * Paystack. The order is created like any other (prices, stock and delivery fees from the
 * database, stock held), then a payment link settled to the seller's subaccount; Paystack's
 * webhook marks it paid as usual. Unpaid store orders are cancelled after
 * STORE_CHECKOUT_MINUTES so held stock goes back on sale.
 */

const o = schema.orders;
const UNPAID: schema.OrderStatus[] = ['new', 'awaiting_payment'];
const HOUR = 3_600_000;
const storefront = (businessId: string): StorefrontActor => ({ businessId, storefront: true });

async function checkoutOpenInTx(tx: Tx): Promise<boolean> {
  const [b] = await tx
    .select({
      enabled: schema.businesses.storeCheckoutEnabled,
      subaccount: schema.businesses.paystackSubaccountCode,
      suspendedAt: schema.businesses.suspendedAt,
    })
    .from(schema.businesses)
    .limit(1);
  return Boolean(b?.enabled && b.subaccount && !b.suspendedAt);
}

export type StoreCartLine = {
  variantId: string;
  productId: string;
  productName: string;
  /** "M / Red"; empty for a product without sizes or colours. */
  variantLabel: string;
  photo: StoredImage | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isWholesale: boolean;
  /** What is in stock now. */
  available: number;
  /** Why this line can't be bought as it is, or null. */
  problem: 'unavailable' | 'not_enough' | null;
};

export type StoreCart = {
  /** The seller takes payment on the store (setting on and a payout account). */
  checkoutOpen: boolean;
  lines: StoreCartLine[];
  subtotal: number;
  deliveryZones: { id: string; name: string; fee: number; estimatedTime: string }[];
};

const cartLines = z
  .array(
    z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(MAX_CART_QUANTITY) }),
  )
  .max(MAX_CART_LINES);

/**
 * The shopper's cart priced from the database (never from the cookie), with what's in stock.
 * Hidden, archived or unknown options come back as "unavailable".
 */
export async function getStoreCart(businessId: string, lines: CartLine[]): Promise<StoreCart> {
  const id = z.uuid().parse(businessId);
  const items = cartLines.parse(lines);
  return withTenant(id, async (tx) => {
    const p = schema.products;
    const v = schema.productVariants;
    const rows = items.length
      ? await tx
          .select({ variant: v, product: p })
          .from(v)
          .innerJoin(p, eq(p.id, v.productId))
          .where(
            inArray(
              v.id,
              items.map((i) => i.variantId),
            ),
          )
      : [];
    const byId = new Map(rows.map((r) => [r.variant.id, r]));
    const result: StoreCartLine[] = [];
    for (const item of items) {
      const row = byId.get(item.variantId);
      const visible =
        row && row.product.isActive && !row.product.archivedAt && !row.variant.archivedAt;
      if (!row) continue; // never existed here: drop quietly
      const { unitPrice, isWholesale } = unitPriceFor(row.product, row.variant, item.quantity);
      result.push({
        variantId: item.variantId,
        productId: row.product.id,
        productName: row.product.name,
        variantLabel: row.variant.isDefault ? '' : variantLabel(row.variant),
        photo: row.product.photos[0] ?? null,
        quantity: item.quantity,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
        isWholesale,
        available: Math.max(0, row.variant.stock),
        problem: !visible ? 'unavailable' : row.variant.stock < item.quantity ? 'not_enough' : null,
      });
    }
    const deliveryZones = await tx
      .select({
        id: schema.deliveryZones.id,
        name: schema.deliveryZones.name,
        fee: schema.deliveryZones.fee,
        estimatedTime: schema.deliveryZones.estimatedTime,
      })
      .from(schema.deliveryZones)
      .where(and(isNull(schema.deliveryZones.archivedAt), eq(schema.deliveryZones.isActive, true)))
      .orderBy(asc(schema.deliveryZones.name));
    return {
      checkoutOpen: await checkoutOpenInTx(tx),
      lines: result,
      subtotal: result
        .filter((l) => l.problem !== 'unavailable')
        .reduce((sum, l) => sum + l.lineTotal, 0),
      deliveryZones,
    };
  });
}

export const storeCheckoutInput = z
  .object({
    items: cartLines.min(1, 'Your cart is empty.'),
    name: z.string().trim().min(2, 'Enter your name.').max(80),
    phone: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const phone = normalizePhoneNumber(value);
        if (!phone) {
          ctx.addIssue({
            code: 'custom',
            message: 'Enter a valid phone number, e.g. 0803 123 4567.',
          });
          return z.NEVER;
        }
        return phone;
      }),
    email: z.union([z.literal(''), z.email('Enter a valid email, or leave it empty.')]).default(''),
    fulfilment: z.enum(schema.fulfilmentMethods),
    deliveryZoneId: z.uuid().nullish(),
    deliveryAddress: z.string().trim().max(300).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.fulfilment === 'delivery' && !v.deliveryZoneId)
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryZoneId'],
        message: 'Choose a delivery area.',
      });
    if (v.fulfilment === 'delivery' && v.deliveryAddress.length < 5)
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Enter the delivery address.',
      });
  });
export type StoreCheckoutInput = z.input<typeof storeCheckoutInput>;

export type StoreCheckout = { orderNumber: number; paymentUrl: string; receiptToken: string };

/**
 * Starts a store checkout: limits (per device and per phone), creates the order as the shopper
 * (channel "store"; an earlier unpaid store order of the same phone is cancelled first, so a
 * shopper who comes back to change their cart doesn't hold stock twice), then a Paystack
 * payment link. If Paystack fails, the order is cancelled and its stock returned.
 */
export async function startStoreCheckout(
  businessId: string,
  input: StoreCheckoutInput,
  client: { key: string },
): Promise<StoreCheckout> {
  const id = z.uuid().parse(businessId);
  const parsed = storeCheckoutInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new CoreError('validation', issue.message, String(issue.path[0] ?? ''));
  }
  const data = parsed.data;
  const allowed =
    (await consumeRateLimit(`store-checkout:client:${id}:${client.key}`, 8, HOUR)) &&
    (await consumeRateLimit(`store-checkout:phone:${id}:${data.phone}`, 6, HOUR));
  if (!allowed) {
    throw new CoreError(
      'conflict',
      'Too many checkouts in a short time. Please wait a little, or order on WhatsApp.',
    );
  }

  const order = await withTenant(id, async (tx) => {
    if (!(await checkoutOpenInTx(tx))) {
      throw new CoreError(
        'conflict',
        'This store takes orders on WhatsApp. Tap "Order on WhatsApp".',
      );
    }
    const [existing] = await tx
      .select({ id: schema.customers.id, email: schema.customers.email })
      .from(schema.customers)
      .where(eq(schema.customers.phone, data.phone))
      .limit(1);
    if (existing) {
      const unpaid = await tx
        .select({ id: o.id })
        .from(o)
        .where(
          and(
            eq(o.customerId, existing.id),
            eq(o.channel, 'store'),
            inArray(o.status, UNPAID),
            eq(o.amountPaid, 0),
          ),
        );
      for (const previous of unpaid) {
        await cancelOrderInTx(tx, id, previous.id, 'Replaced by a new store checkout', {
          type: 'customer',
        });
      }
    }
    const detail = await createOrderInTx(
      tx,
      id,
      {
        customer: { name: data.name, phone: data.phone },
        items: data.items,
        fulfilment: data.fulfilment,
        deliveryZoneId: data.fulfilment === 'delivery' ? data.deliveryZoneId : null,
        deliveryAddress: data.fulfilment === 'delivery' ? data.deliveryAddress : '',
        channel: 'store',
      },
      { type: 'customer' },
    );
    if (data.email) {
      await tx
        .update(schema.customers)
        .set({ email: data.email })
        .where(and(eq(schema.customers.id, detail.customer.id), isNull(schema.customers.email)));
    }
    return detail.order;
  });

  try {
    const link = await createPaymentLink(storefront(id), order.id);
    return {
      orderNumber: order.orderNumber,
      paymentUrl: link.url,
      receiptToken: order.receiptToken,
    };
  } catch (error) {
    await withTenant(id, (tx) =>
      cancelOrderInTx(tx, id, order.id, 'The payment page could not open', { type: 'system' }),
    );
    throw error;
  }
}

/**
 * Worker: cancels this business's store orders still unpaid after STORE_CHECKOUT_MINUTES and
 * returns their stock. Money that arrives later is flagged for the owner to check, as for any
 * cancelled order. Returns how many were cancelled.
 */
export async function expireStoreCheckouts(businessId: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STORE_CHECKOUT_MINUTES * 60_000);
  return withTenant(businessId, async (tx) => {
    const stale = await tx
      .select({ id: o.id })
      .from(o)
      .where(and(eq(o.channel, 'store'), inArray(o.status, UNPAID), lt(o.createdAt, cutoff)))
      .orderBy(asc(o.createdAt))
      .limit(100);
    let cancelled = 0;
    for (const { id } of stale) {
      // Re-read under the row lock: a payment may have just arrived.
      const [order] = await tx.select().from(o).where(eq(o.id, id)).for('update').limit(1);
      if (!order || !UNPAID.includes(order.status) || order.amountPaid > 0) continue;
      await cancelOrderInTx(
        tx,
        businessId,
        id,
        `Not paid within ${STORE_CHECKOUT_MINUTES} minutes of the store checkout`,
        { type: 'system' },
      );
      cancelled++;
    }
    return cancelled;
  });
}

/** Businesses with store orders past the payment time (system access: the job's list, 0003). */
export async function businessesWithStaleStoreCheckouts(now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STORE_CHECKOUT_MINUTES * 60_000);
  const rows = await withSystem((tx) =>
    tx
      .selectDistinct({ businessId: o.businessId })
      .from(o)
      .where(
        and(
          eq(o.channel, 'store'),
          inArray(o.status, UNPAID),
          lt(o.createdAt, cutoff),
          sql`${o.createdAt} > ${new Date(now.getTime() - 30 * 24 * HOUR).toISOString()}::timestamptz`,
        ),
      ),
  );
  return rows.map((r) => r.businessId);
}

// ─── The seller's switch (Settings → Store) ──────────────────────────────────

export type StoreCheckoutSetting = {
  enabled: boolean;
  /** A payout account is set up (checkout needs one). */
  hasPayout: boolean;
};

export async function getStoreCheckoutSetting(actor: ActorContext): Promise<StoreCheckoutSetting> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const [b] = await tx
      .select({
        enabled: schema.businesses.storeCheckoutEnabled,
        subaccount: schema.businesses.paystackSubaccountCode,
      })
      .from(schema.businesses)
      .limit(1);
    return { enabled: b?.enabled ?? true, hasPayout: Boolean(b?.subaccount) };
  });
}

/** Owner only: let customers pay on the store, or keep it WhatsApp-only. */
export async function setStoreCheckoutEnabled(
  actor: ActorContext,
  enabled: boolean,
): Promise<StoreCheckoutSetting> {
  const on = z.boolean().parse(enabled);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    await tx
      .update(schema.businesses)
      .set({ storeCheckoutEnabled: on })
      .where(eq(schema.businesses.id, actor.businessId));
  });
  return getStoreCheckoutSetting(actor);
}
