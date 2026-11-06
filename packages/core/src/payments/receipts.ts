import { schema, withSystem } from '@fulcra/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

export type Receipt = {
  business: { name: string; subdomain: string; whatsappNumber: string };
  brand: { primaryColour: string; accentColour: string; logo: schema.StoredImage | null };
  order: Pick<
    schema.Order,
    | 'orderNumber'
    | 'status'
    | 'fulfilment'
    | 'deliveryZoneName'
    | 'subtotal'
    | 'deliveryFee'
    | 'discount'
    | 'total'
    | 'amountPaid'
    | 'paymentMethod'
    | 'createdAt'
    | 'paidAt'
  >;
  customerName: string;
  items: Pick<
    schema.OrderItem,
    'productName' | 'variantLabel' | 'quantity' | 'unitPrice' | 'lineTotal'
  >[];
  isPaid: boolean;
};

const PAID = ['paid', 'dispatched', 'delivered'] as const;
const tokenSchema = z.string().regex(/^[0-9a-f]{32}$/);

/**
 * The public receipt for an order, found by its store address and secret receipt code.
 * A system lookup (the customer is not signed in): it needs both the subdomain and the
 * unguessable token, and returns only what a receipt shows. Unpaid orders return
 * `isPaid: false` with no items, for the "confirming your payment" page.
 */
export async function getReceipt(subdomain: string, token: string): Promise<Receipt | null> {
  if (!tokenSchema.safeParse(token).success) return null;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({
        order: schema.orders,
        business: schema.businesses,
        customerName: schema.customers.name,
      })
      .from(schema.orders)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.orders.businessId))
      .innerJoin(schema.customers, eq(schema.customers.id, schema.orders.customerId))
      .where(
        and(
          eq(schema.orders.receiptToken, token),
          eq(schema.businesses.subdomain, subdomain.toLowerCase()),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { order, business } = row;
    const isPaid = (PAID as readonly string[]).includes(order.status);
    const [kit] = await tx
      .select()
      .from(schema.brandKits)
      .where(eq(schema.brandKits.businessId, business.id))
      .limit(1);
    const items = isPaid
      ? await tx
          .select({
            productName: schema.orderItems.productName,
            variantLabel: schema.orderItems.variantLabel,
            quantity: schema.orderItems.quantity,
            unitPrice: schema.orderItems.unitPrice,
            lineTotal: schema.orderItems.lineTotal,
          })
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, order.id))
          .orderBy(asc(schema.orderItems.position))
      : [];
    return {
      business: {
        name: business.name,
        subdomain: business.subdomain,
        whatsappNumber: business.whatsappNumber,
      },
      brand: {
        primaryColour: kit?.primaryColour ?? '#0f6b55',
        accentColour: kit?.accentColour ?? '#f5a524',
        logo: kit?.logo ?? null,
      },
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        fulfilment: order.fulfilment,
        deliveryZoneName: order.deliveryZoneName,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        total: order.total,
        amountPaid: order.amountPaid,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
      },
      customerName: row.customerName,
      items,
      isPaid,
    };
  });
}
