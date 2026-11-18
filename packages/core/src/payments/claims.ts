import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { PaymentProof } from '../agent/photos';
import { recordEvent } from '../events/events';
import {
  CLAIM_WAIT_MINUTES,
  claimFlags,
  normalizeReference,
  parseReceiptTime,
} from './claim-rules';

/**
 * Fake alert protection (F1, docs/decisions/0024). When a customer sends a transfer
 * screenshot or says they paid, a claim is saved and checked against the money that really
 * arrived (Paystack link or the customer's own transfer account). A screenshot never marks
 * anything paid. Nothing after CLAIM_WAIT_MINUTES → "not received" and an event the owner
 * alert picks up; money arriving later clears it.
 */

const pc = schema.paymentClaims;
const o = schema.orders;
const UNPAID: schema.OrderStatus[] = ['new', 'awaiting_payment'];
/** Payments up to this long before a claim count for it (money often lands before the screenshot). */
const EARLY_PAYMENT_MS = 2 * 3_600_000;
/** Claims older than this are no longer checked. */
const CHECK_FOR_MS = 7 * 24 * 3_600_000;

const isPaid = (order: Pick<schema.Order, 'paidAt' | 'status'>) =>
  order.paidAt !== null || ['paid', 'dispatched', 'delivered'].includes(order.status);

/** The unpaid order a screenshot is most likely for: the one it pays exactly, else the newest. */
async function orderForScreenshot(tx: Tx, customerId: string, claimedAmount: number | null) {
  const unpaid = await tx
    .select()
    .from(o)
    .where(and(eq(o.customerId, customerId), inArray(o.status, UNPAID)))
    .orderBy(desc(o.createdAt))
    .limit(10);
  if (claimedAmount !== null) {
    const exact = unpaid.find(
      (order) => order.total - order.amountPaid === claimedAmount || order.total === claimedAmount,
    );
    if (exact) return exact;
  }
  return unpaid[0] ?? null;
}

/** Whether another claim used this receipt reference for a different order or customer. */
async function referenceUsedElsewhere(
  tx: Tx,
  reference: string | null,
  customerId: string,
  orderId: string | null,
): Promise<boolean> {
  if (!reference) return false;
  const [other] = await tx
    .select({ id: pc.id })
    .from(pc)
    .where(
      and(
        eq(pc.reference, reference),
        or(
          ne(pc.customerId, customerId),
          orderId ? sql`${pc.orderId} is distinct from ${orderId}` : sql`${pc.orderId} is not null`,
        ),
      ),
    )
    .limit(1);
  return Boolean(other);
}

/**
 * Saves the claim for a customer's payment screenshot (once per message). It is linked to the
 * customer's unpaid order when there is one; a "said they paid" claim already waiting for that
 * order is upgraded with the screenshot instead of adding a second one.
 */
export async function recordScreenshotClaimInTx(
  tx: Tx,
  businessId: string,
  message: Pick<schema.Message, 'id' | 'conversationId' | 'media'>,
  payment: PaymentProof | null,
  now = new Date(),
): Promise<string | null> {
  const [done] = await tx.select({ id: pc.id }).from(pc).where(eq(pc.messageId, message.id));
  if (done) return done.id;
  const [conversation] = await tx
    .select({ customerId: schema.conversations.customerId })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, message.conversationId))
    .limit(1);
  if (!conversation) return null;
  const claimedAmount = payment?.amountNaira != null ? Math.round(payment.amountNaira * 100) : null;
  const receipt = parseReceiptTime(payment?.dateTime);
  const reference = normalizeReference(payment?.reference);
  const picked = await orderForScreenshot(tx, conversation.customerId, claimedAmount);
  // Lock the order so two messages can't create two waiting claims for it at once.
  const [order] = picked
    ? await tx.select().from(o).where(eq(o.id, picked.id)).for('update').limit(1)
    : [];
  const flags = claimFlags({
    claimedAmount,
    receipt,
    order: order ?? null,
    referenceUsedElsewhere: await referenceUsedElsewhere(
      tx,
      reference,
      conversation.customerId,
      order?.id ?? null,
    ),
    now,
  });
  const details = {
    source: 'screenshot' as const,
    messageId: message.id,
    claimedAmount,
    bank: payment?.bank || null,
    senderName: payment?.senderName || null,
    reference,
    claimedPaidAt: receipt?.at ?? null,
    image: message.media?.image ?? null,
    flags,
  };
  if (order) {
    const [said] = await tx
      .select({ id: pc.id })
      .from(pc)
      .where(and(eq(pc.orderId, order.id), eq(pc.status, 'waiting'), isNull(pc.messageId)))
      .limit(1);
    if (said) {
      await tx.update(pc).set(details).where(eq(pc.id, said.id));
      return said.id;
    }
  }
  const [row] = await tx
    .insert(pc)
    .values({
      businessId,
      customerId: conversation.customerId,
      orderId: order?.id ?? null,
      conversationId: message.conversationId,
      status: order && isPaid(order) ? 'confirmed' : 'waiting',
      confirmedAt: order && isPaid(order) ? now : null,
      receivedAmount: order ? order.amountPaid : null,
      ...details,
    })
    .returning({ id: pc.id });
  return row?.id ?? null;
}

/**
 * Saves a "the customer says they paid" claim for an unpaid order (from the assistant's
 * payment check). One open claim per order: an existing one is returned instead.
 */
export async function recordSaidPaidClaimInTx(
  tx: Tx,
  businessId: string,
  input: { customerId: string; conversationId: string; orderId: string },
): Promise<schema.PaymentClaim | null> {
  const [order] = await tx.select().from(o).where(eq(o.id, input.orderId)).for('update').limit(1);
  if (!order || isPaid(order) || order.status === 'cancelled') return null;
  const [open] = await tx
    .select()
    .from(pc)
    .where(and(eq(pc.orderId, order.id), inArray(pc.status, ['waiting', 'not_received'])))
    .orderBy(desc(pc.createdAt))
    .limit(1);
  if (open) return open;
  const [row] = await tx
    .insert(pc)
    .values({
      businessId,
      customerId: input.customerId,
      orderId: order.id,
      conversationId: input.conversationId,
      source: 'customer_said',
      receivedAmount: order.amountPaid,
    })
    .returning();
  return row ?? null;
}

/** The newest claim for an order (for the assistant's answer). */
export async function latestClaimForOrderInTx(
  tx: Tx,
  orderId: string,
): Promise<schema.PaymentClaim | null> {
  const [row] = await tx
    .select()
    .from(pc)
    .where(eq(pc.orderId, orderId))
    .orderBy(desc(pc.createdAt))
    .limit(1);
  return row ?? null;
}

type Money = {
  /** The money the claim is about has arrived. */
  arrived: boolean;
  /** Money from this customer arrived but waits for the owner to match it (P2). */
  toCheck: boolean;
  received: number | null;
  cancelled: boolean;
};

async function moneyForClaim(tx: Tx, claim: schema.PaymentClaim): Promise<Money> {
  const since = new Date(claim.createdAt.getTime() - EARLY_PAYMENT_MS);
  const p = schema.payments;
  const fromCustomer = (statuses: schema.PaymentStatus[]) =>
    tx
      .select({ amount: p.amount })
      .from(p)
      .where(
        and(
          eq(p.customerId, claim.customerId),
          inArray(p.status, statuses),
          gte(p.createdAt, since),
        ),
      )
      .limit(5);
  const toCheck = (await fromCustomer(['unmatched', 'needs_review'])).length > 0;
  if (claim.orderId) {
    const [order] = await tx.select().from(o).where(eq(o.id, claim.orderId)).limit(1);
    if (!order) return { arrived: false, toCheck, received: null, cancelled: true };
    return {
      arrived: isPaid(order),
      toCheck,
      received: order.amountPaid,
      cancelled: order.status === 'cancelled',
    };
  }
  const paid = await fromCustomer(['success']);
  const received = paid.reduce((sum, row) => sum + row.amount, 0);
  return { arrived: paid.length > 0, toCheck, received: received || null, cancelled: false };
}

/**
 * Worker, every minute: checks open claims against the money. Arrived → confirmed (and, if
 * the owner was already warned, a `payment.claim_cleared` event). Still nothing after
 * CLAIM_WAIT_MINUTES (and no unmatched transfer from the customer waiting for the owner) →
 * not received, with a `payment.claim_unverified` event for the owner alert. Claims for
 * cancelled orders are closed quietly.
 */
export async function sweepPaymentClaims(
  businessId: string,
  now = new Date(),
): Promise<{ confirmed: number; notReceived: number; closed: number }> {
  return withTenant(businessId, async (tx) => {
    const open = await tx
      .select()
      .from(pc)
      .where(
        and(
          inArray(pc.status, ['waiting', 'not_received']),
          gte(pc.createdAt, new Date(now.getTime() - CHECK_FOR_MS)),
        ),
      )
      .orderBy(pc.createdAt)
      .limit(200);
    const result = { confirmed: 0, notReceived: 0, closed: 0 };
    const due = new Date(now.getTime() - CLAIM_WAIT_MINUTES * 60_000);
    for (const claim of open) {
      const money = await moneyForClaim(tx, claim);
      const base = { orderId: claim.orderId, customerId: claim.customerId };
      if (money.cancelled && !money.arrived) {
        await tx
          .update(pc)
          .set({ status: 'dismissed', dismissedAt: now })
          .where(eq(pc.id, claim.id));
        result.closed++;
      } else if (money.arrived) {
        await tx
          .update(pc)
          .set({ status: 'confirmed', confirmedAt: now, receivedAmount: money.received })
          .where(eq(pc.id, claim.id));
        if (claim.status === 'not_received') {
          await recordEvent(tx, businessId, {
            type: 'payment.claim_cleared',
            actor: { type: 'system' },
            ...base,
            payload: { claimId: claim.id, amount: money.received ?? claim.claimedAmount ?? 0 },
          });
        }
        result.confirmed++;
      } else if (claim.status === 'waiting' && claim.createdAt <= due && !money.toCheck) {
        let amount = claim.claimedAmount;
        if (amount === null && claim.orderId) {
          const [order] = await tx
            .select({ total: o.total, amountPaid: o.amountPaid })
            .from(o)
            .where(eq(o.id, claim.orderId))
            .limit(1);
          amount = order ? order.total - order.amountPaid : null;
        }
        await tx
          .update(pc)
          .set({ status: 'not_received', notReceivedAt: now, receivedAmount: money.received })
          .where(eq(pc.id, claim.id));
        await recordEvent(tx, businessId, {
          type: 'payment.claim_unverified',
          actor: { type: 'system' },
          ...base,
          payload: {
            claimId: claim.id,
            source: claim.source,
            amount: amount ?? 0,
            flags: claim.flags,
            conversationId: claim.conversationId,
            claimedAt: claim.createdAt.toISOString(),
          },
        });
        result.notReceived++;
      } else if (money.received !== claim.receivedAmount) {
        await tx.update(pc).set({ receivedAmount: money.received }).where(eq(pc.id, claim.id));
      }
    }
    return result;
  });
}

/** Businesses with claims still being checked (system access: the job's list, 0003). */
export async function businessesWithOpenClaims(now = new Date()): Promise<string[]> {
  const rows = await withSystem((tx) =>
    tx
      .selectDistinct({ businessId: pc.businessId })
      .from(pc)
      .where(
        and(
          inArray(pc.status, ['waiting', 'not_received']),
          gte(pc.createdAt, new Date(now.getTime() - CHECK_FOR_MS)),
          lte(pc.createdAt, now),
        ),
      ),
  );
  return rows.map((r) => r.businessId);
}
