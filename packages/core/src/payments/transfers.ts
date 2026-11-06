import { schema, withTenant } from '@fulcra/db';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor } from '../events/events';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import type { PaystackVerifiedTransaction } from './paystack';

const EDITORS = ['owner', 'staff'] as const;
const UNPAID = ['new', 'awaiting_payment'] as const;

/**
 * A verified transfer into a customer's dedicated account (worker). Recorded once (unique
 * reference). Matched automatically to that customer's oldest unpaid order with exactly
 * this total; anything else is "unmatched" for the owner (docs/decisions/0002, 0007).
 */
export async function recordDedicatedTransfer(
  account: { businessId: string; customerId: string },
  verified: PaystackVerifiedTransaction,
): Promise<'matched' | 'unmatched' | 'already_confirmed'> {
  if (verified.status !== 'success') {
    throw new Error(`Paystack reports status "${verified.status}" for ${verified.reference}`);
  }
  return withTenant(account.businessId, async (tx) => {
    const paidAt = verified.paidAt ? new Date(verified.paidAt) : new Date();
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        businessId: account.businessId,
        customerId: account.customerId,
        provider: 'paystack',
        reference: verified.reference,
        amount: verified.amount,
        currency: verified.currency,
        status: 'unmatched',
        method: verified.channel ?? 'dedicated_nuban',
        paidAt,
        providerData: {
          transactionId: verified.id,
          channel: verified.channel,
          paidAt: verified.paidAt,
        },
      })
      .onConflictDoNothing({ target: [schema.payments.provider, schema.payments.reference] })
      .returning();
    if (!payment) return 'already_confirmed';

    const [order] =
      verified.currency === 'NGN'
        ? await tx
            .select()
            .from(schema.orders)
            .where(
              and(
                eq(schema.orders.customerId, account.customerId),
                inArray(schema.orders.status, [...UNPAID]),
                eq(schema.orders.amountPaid, 0),
                eq(schema.orders.total, verified.amount),
              ),
            )
            .orderBy(asc(schema.orders.createdAt))
            .for('update')
            .limit(1)
        : [];

    if (!order) {
      const reason =
        verified.currency !== 'NGN'
          ? `Paid in ${verified.currency}.`
          : 'No unpaid order from this customer for exactly this amount.';
      await tx
        .update(schema.payments)
        .set({ reviewReason: reason })
        .where(eq(schema.payments.id, payment.id));
      await recordEvent(tx, account.businessId, {
        type: 'payment.unmatched',
        actor: { type: 'system' },
        customerId: account.customerId,
        payload: { amount: verified.amount, reference: verified.reference, reason },
      });
      return 'unmatched';
    }

    await markPaidByPayment(
      tx,
      account.businessId,
      order,
      payment,
      { type: 'system' },
      'automatic',
    );
    return 'matched';
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function markPaidByPayment(
  tx: Tx,
  businessId: string,
  order: schema.Order,
  payment: schema.Payment,
  actor: { type: 'system' } | { type: 'user'; id: string },
  match: 'automatic' | 'manual',
) {
  await tx
    .update(schema.orders)
    .set({
      status: 'paid',
      amountPaid: order.amountPaid + payment.amount,
      paymentMethod: 'bank_transfer',
      paidAt: payment.paidAt ?? new Date(),
    })
    .where(eq(schema.orders.id, order.id));
  await tx
    .update(schema.payments)
    .set({ status: 'success', orderId: order.id, reviewReason: null })
    .where(eq(schema.payments.id, payment.id));
  await recordEvent(tx, businessId, {
    type: 'payment.confirmed',
    actor,
    orderId: order.id,
    customerId: order.customerId,
    payload: {
      orderNumber: order.orderNumber,
      amount: payment.amount,
      method: 'bank_transfer',
      reference: payment.reference,
      match,
    },
  });
}

/**
 * Owner assigns an unmatched transfer to an order. The amount must equal what the order
 * still owes (part payments come later).
 */
export async function assignPayment(
  actor: ActorContext,
  paymentId: string,
  orderId: string,
): Promise<void> {
  const pid = z.uuid().parse(paymentId);
  const oid = z.uuid().parse(orderId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, pid))
      .for('update')
      .limit(1);
    if (!payment) throw new CoreError('not_found', 'This payment no longer exists.');
    if (payment.status !== 'unmatched')
      throw new CoreError('conflict', 'This payment is already handled.');
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, oid))
      .for('update')
      .limit(1);
    if (!order) throw new CoreError('not_found', 'This order no longer exists.', 'orderId');
    if (!(UNPAID as readonly string[]).includes(order.status) || order.amountPaid > 0) {
      throw new CoreError('conflict', 'Choose an order that is not paid yet.', 'orderId');
    }
    if (order.total !== payment.amount) {
      throw new CoreError(
        'conflict',
        'The amounts are different. Part payments are not supported yet, so choose an order with exactly this total.',
        'orderId',
      );
    }
    await markPaidByPayment(
      tx,
      actor.businessId,
      order,
      payment,
      userActor(actor) as { type: 'user'; id: string },
      'manual',
    );
  });
}

/** Owner marks an unmatched or flagged payment as handled without an order (e.g. a refund was made). */
export async function dismissPayment(
  actor: ActorContext,
  paymentId: string,
  note: string,
): Promise<void> {
  const pid = z.uuid().parse(paymentId);
  const reason = z.string().trim().max(300).parse(note);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const updated = await tx
      .update(schema.payments)
      .set({ status: 'dismissed', reviewReason: reason || 'Marked as not for an order' })
      .where(
        and(
          eq(schema.payments.id, pid),
          inArray(schema.payments.status, ['unmatched', 'needs_review']),
        ),
      )
      .returning({ id: schema.payments.id });
    if (updated.length === 0) throw new CoreError('conflict', 'This payment is already handled.');
  });
}

export const paymentListFilter = z.object({
  show: z.enum(['all', 'unmatched', 'review']).default('all'),
});

export type PaymentListItem = Pick<
  schema.Payment,
  | 'id'
  | 'provider'
  | 'reference'
  | 'amount'
  | 'status'
  | 'method'
  | 'reviewReason'
  | 'paidAt'
  | 'createdAt'
  | 'orderId'
  | 'customerId'
> & { orderNumber: number | null; customerName: string | null };

/** Payments, newest first. "unmatched" = transfers to assign; "review" = needs your attention. */
export async function listPayments(
  actor: ActorContext,
  filter: z.input<typeof paymentListFilter> = {},
): Promise<PaymentListItem[]> {
  const f = paymentListFilter.parse(filter);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    const p = schema.payments;
    const conditions: SQL[] = [];
    if (f.show === 'unmatched') conditions.push(eq(p.status, 'unmatched'));
    else if (f.show === 'review') conditions.push(eq(p.status, 'needs_review'));
    else conditions.push(inArray(p.status, ['success', 'unmatched', 'needs_review', 'dismissed']));
    return tx
      .select({
        id: p.id,
        provider: p.provider,
        reference: p.reference,
        amount: p.amount,
        status: p.status,
        method: p.method,
        reviewReason: p.reviewReason,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        orderId: p.orderId,
        customerId: p.customerId,
        orderNumber: schema.orders.orderNumber,
        customerName: schema.customers.name,
      })
      .from(p)
      .leftJoin(schema.orders, eq(schema.orders.id, p.orderId))
      .leftJoin(schema.customers, eq(schema.customers.id, p.customerId))
      .where(and(...conditions))
      .orderBy(desc(p.createdAt))
      .limit(500);
  });
}

/** How many transfers wait to be assigned and payments need checking (for badges). */
export async function countPaymentsNeedingAttention(
  actor: ActorContext,
): Promise<{ unmatched: number; review: number }> {
  const rows = await listPaymentsCounts(actor);
  return rows;
}

async function listPaymentsCounts(actor: ActorContext) {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const rows = await tx
      .select({ status: schema.payments.status })
      .from(schema.payments)
      .where(inArray(schema.payments.status, ['unmatched', 'needs_review']));
    return {
      unmatched: rows.filter((r) => r.status === 'unmatched').length,
      review: rows.filter((r) => r.status === 'needs_review').length,
    };
  });
}
