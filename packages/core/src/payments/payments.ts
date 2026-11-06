import { randomBytes } from 'node:crypto';
import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent, userActor } from '../events/events';
import { requireMember, type ActorContext } from '../members/access';
import { CoreError } from '../shared/errors';
import {
  getPaystackClient,
  getPaystackSecretKey,
  verifyPaystackSignature,
  type PaystackVerifiedTransaction,
} from './paystack';
import { recordDedicatedTransfer } from './transfers';
import { paymentEmailFor, receiptUrl } from './urls';

const EDITORS = ['owner', 'staff'] as const;
const LINK_REUSE_HOURS = 24;
const UNPAID = ['new', 'awaiting_payment'] as const;

export type PaymentLink = { url: string; reference: string; reused: boolean };

type Prepared =
  | { kind: 'reuse'; url: string; reference: string }
  | {
      kind: 'create';
      paymentId: string;
      reference: string;
      amount: number;
      orderNumber: number;
      subaccount: string;
      email: string;
      callbackUrl: string;
    };

/**
 * Creates (or reuses) a Paystack checkout for the full order total, settled to the
 * business's subaccount. Moves a new order to "awaiting payment".
 */
export async function createPaymentLink(
  actor: ActorContext,
  orderId: string,
): Promise<PaymentLink> {
  const id = z.uuid().parse(orderId);

  const prepared = await withTenant(actor.businessId, async (tx): Promise<Prepared> => {
    await requireMember(tx, actor, EDITORS);
    const [business] = await tx
      .select({
        subaccount: schema.businesses.paystackSubaccountCode,
        subdomain: schema.businesses.subdomain,
      })
      .from(schema.businesses)
      .limit(1);
    if (!business?.subaccount) {
      throw new CoreError(
        'conflict',
        'Set up where you get paid first (Settings → Get paid).',
        'payout',
      );
    }
    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .for('update')
      .limit(1);
    if (!order) throw new CoreError('not_found', 'This order no longer exists.');
    if (!(UNPAID as readonly string[]).includes(order.status)) {
      throw new CoreError('conflict', 'Payment links are only for orders that are not paid yet.');
    }

    const [recent] = await tx
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.orderId, id),
          eq(schema.payments.provider, 'paystack'),
          eq(schema.payments.status, 'pending'),
          eq(schema.payments.amount, order.total),
          gt(schema.payments.createdAt, new Date(Date.now() - LINK_REUSE_HOURS * 3600_000)),
        ),
      )
      .orderBy(desc(schema.payments.createdAt))
      .limit(1);
    if (recent?.checkoutUrl) {
      return {
        kind: 'reuse',
        url: recent.checkoutUrl,
        reference: recent.reference,
      } satisfies Prepared;
    }

    const [customer] = await tx
      .select({ email: schema.customers.email, phone: schema.customers.phone })
      .from(schema.customers)
      .where(eq(schema.customers.id, order.customerId))
      .limit(1);
    const reference = `FUL-${order.orderNumber}-${randomBytes(4).toString('hex')}`;
    const [payment] = await tx
      .insert(schema.payments)
      .values({
        businessId: actor.businessId,
        orderId: id,
        provider: 'paystack',
        reference,
        amount: order.total,
        createdBy: actor.userId,
      })
      .returning();
    return {
      kind: 'create',
      paymentId: payment!.id,
      reference,
      amount: order.total,
      orderNumber: order.orderNumber,
      subaccount: business.subaccount,
      email: paymentEmailFor(customer!, `${order.orderNumber}-${actor.businessId.slice(0, 8)}`),
      callbackUrl: receiptUrl(business.subdomain, order.receiptToken),
    } satisfies Prepared;
  });

  if (prepared.kind === 'reuse')
    return { url: prepared.url, reference: prepared.reference, reused: true };
  const p = prepared;

  let url: string;
  try {
    ({ authorizationUrl: url } = await getPaystackClient().initializeTransaction({
      email: p.email,
      amount: p.amount,
      reference: p.reference,
      subaccount: p.subaccount,
      callbackUrl: p.callbackUrl,
      metadata: { businessId: actor.businessId, orderId: id, orderNumber: p.orderNumber },
    }));
  } catch (error) {
    await withTenant(actor.businessId, (tx) =>
      tx
        .update(schema.payments)
        .set({ status: 'failed', reviewReason: 'Could not create the payment link' })
        .where(eq(schema.payments.id, p.paymentId)),
    );
    if (error instanceof CoreError) throw error;
    throw new CoreError(
      'conflict',
      'Paystack could not create the payment link. Please try again.',
    );
  }

  await withTenant(actor.businessId, async (tx) => {
    await tx
      .update(schema.payments)
      .set({ checkoutUrl: url })
      .where(eq(schema.payments.id, p.paymentId));
    const [order] = await tx
      .update(schema.orders)
      .set({ status: 'awaiting_payment' })
      .where(and(eq(schema.orders.id, id), eq(schema.orders.status, 'new')))
      .returning({ customerId: schema.orders.customerId });
    if (order) {
      await recordEvent(tx, actor.businessId, {
        type: 'order.status_changed',
        actor: userActor(actor),
        orderId: id,
        customerId: order.customerId,
        payload: { orderNumber: p.orderNumber, from: 'new', to: 'awaiting_payment' },
      });
    }
  });
  return { url, reference: p.reference, reused: false };
}

/** Payments for one order, newest first. */
export async function listOrderPayments(
  actor: ActorContext,
  orderId: string,
): Promise<schema.Payment[]> {
  const id = z.uuid().parse(orderId);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    return tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, id))
      .orderBy(desc(schema.payments.createdAt));
  });
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const webhookBody = z.looseObject({
  event: z.string().min(1).max(100),
  data: z.looseObject({
    id: z.union([z.number(), z.string()]).optional(),
    reference: z.string().optional(),
    customer: z.looseObject({ customer_code: z.string().nullish() }).nullish(),
  }),
});

export type RecordWebhookResult =
  | { status: 'invalid_signature' }
  | { status: 'not_configured' }
  | { status: 'bad_payload' }
  /** Already saved. `processed: false` means it still needs (re)queueing. */
  | { status: 'duplicate'; webhookEventId: string; processed: boolean }
  | { status: 'saved'; webhookEventId: string; eventType: string };

/**
 * Step 1 of rule 8: verify the signature and save the raw event (each event once).
 * The caller enqueues processing and returns 200 quickly.
 */
export async function recordPaystackWebhook(
  rawBody: string,
  signature: string | null,
): Promise<RecordWebhookResult> {
  const secret = getPaystackSecretKey();
  if (!secret) return { status: 'not_configured' };
  if (!verifyPaystackSignature(rawBody, signature, secret)) return { status: 'invalid_signature' };

  let parsed: z.infer<typeof webhookBody>;
  try {
    parsed = webhookBody.parse(JSON.parse(rawBody));
  } catch {
    return { status: 'bad_payload' };
  }
  const key = parsed.data.id ?? parsed.data.reference;
  if (key === undefined) return { status: 'bad_payload' };
  const eventId = `${parsed.event}:${key}`;

  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(schema.webhookEvents)
      .values({ provider: 'paystack', eventId, eventType: parsed.event, payload: parsed })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (row) return { status: 'saved', webhookEventId: row.id, eventType: parsed.event } as const;
    const [existing] = await tx
      .select({ id: schema.webhookEvents.id, processedAt: schema.webhookEvents.processedAt })
      .from(schema.webhookEvents)
      .where(
        and(
          eq(schema.webhookEvents.provider, 'paystack'),
          eq(schema.webhookEvents.eventId, eventId),
        ),
      )
      .limit(1);
    return {
      status: 'duplicate',
      webhookEventId: existing!.id,
      processed: existing!.processedAt !== null,
    } as const;
  });
}

export type ProcessWebhookResult =
  | 'already_processed'
  | 'ignored'
  | 'unknown_reference'
  | 'confirmed'
  | 'already_confirmed'
  | 'needs_review'
  /** A transfer into a dedicated account, matched to an order. */
  | 'matched'
  /** A transfer into a dedicated account that needs the owner to assign it. */
  | 'unmatched';

/**
 * Step 2 (worker): for charge.success, ask Paystack directly whether the payment succeeded,
 * then confirm it. Safe to run any number of times for the same event.
 */
export async function processPaystackWebhook(
  webhookEventId: string,
): Promise<ProcessWebhookResult> {
  const id = z.uuid().parse(webhookEventId);
  const event = await withSystem(async (tx) => {
    const [row] = await tx
      .update(schema.webhookEvents)
      .set({ attempts: sqlIncrement() })
      .where(eq(schema.webhookEvents.id, id))
      .returning();
    return row;
  });
  if (!event) throw new Error(`Webhook event ${id} not found`);
  if (event.processedAt) return 'already_processed';

  const finish = (error: string | null = null) =>
    withSystem((tx) =>
      tx
        .update(schema.webhookEvents)
        .set({ processedAt: new Date(), lastError: error })
        .where(eq(schema.webhookEvents.id, id)),
    );

  if (event.eventType !== 'charge.success') {
    await finish();
    return 'ignored';
  }
  const reference = webhookBody.parse(event.payload).data.reference;
  // Which business? Found by our own payment reference (system lookup across businesses).
  const [payment] = reference
    ? await withSystem((tx) =>
        tx
          .select({ id: schema.payments.id, businessId: schema.payments.businessId })
          .from(schema.payments)
          .where(
            and(eq(schema.payments.provider, 'paystack'), eq(schema.payments.reference, reference)),
          )
          .limit(1),
      )
    : [];
  const verify = async (ref: string): Promise<PaystackVerifiedTransaction> => {
    try {
      return await getPaystackClient().verifyTransaction(ref);
    } catch (error) {
      await withSystem((tx) =>
        tx
          .update(schema.webhookEvents)
          .set({ lastError: String(error).slice(0, 500) })
          .where(eq(schema.webhookEvents.id, id)),
      );
      throw error; // the job retries
    }
  };

  if (!reference) {
    await finish('No payment reference');
    return 'unknown_reference';
  }

  if (!payment) {
    // Not one of our payment links: maybe a transfer into a customer's dedicated account.
    const customerCode = webhookBody.parse(event.payload).data.customer?.customer_code;
    const [account] = customerCode
      ? await withSystem((tx) =>
          tx
            .select({
              businessId: schema.dedicatedAccounts.businessId,
              customerId: schema.dedicatedAccounts.customerId,
              customerCode: schema.dedicatedAccounts.providerCustomerCode,
            })
            .from(schema.dedicatedAccounts)
            .where(
              and(
                eq(schema.dedicatedAccounts.provider, 'paystack'),
                eq(schema.dedicatedAccounts.providerCustomerCode, customerCode),
              ),
            )
            .limit(1),
        )
      : [];
    if (!account) {
      await finish('Unknown payment reference');
      return 'unknown_reference';
    }
    const verified = await verify(reference);
    if (verified.customerCode !== account.customerCode) {
      await finish('Paystack reports a different customer for this transfer');
      return 'unknown_reference';
    }
    const result = await recordDedicatedTransfer(account, verified);
    await finish();
    return result;
  }

  const verified = await verify(reference);
  const result = await confirmPaystackPayment(payment.businessId, payment.id, verified);
  await finish();
  return result;
}

function sqlIncrement() {
  return sql`${schema.webhookEvents.attempts} + 1`;
}

/** Marks a payment confirmed and its order paid, inside the business's tenant scope. */
async function confirmPaystackPayment(
  businessId: string,
  paymentId: string,
  verified: PaystackVerifiedTransaction,
): Promise<ProcessWebhookResult> {
  return withTenant(businessId, async (tx) => {
    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
      .for('update')
      .limit(1);
    if (!payment) throw new Error('Payment disappeared');
    if (payment.status === 'success' || payment.status === 'needs_review')
      return 'already_confirmed';

    if (verified.status !== 'success') {
      // Paystack says it did not succeed (yet): leave it pending and let the job retry.
      throw new Error(`Paystack reports status "${verified.status}" for ${payment.reference}`);
    }

    const [order] = await tx
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, payment.orderId!))
      .for('update')
      .limit(1);
    const providerData = {
      transactionId: verified.id,
      channel: verified.channel,
      paidAt: verified.paidAt,
    };
    const paidAt = verified.paidAt ? new Date(verified.paidAt) : new Date();

    let review: string | null = null;
    if (verified.amount !== payment.amount || verified.currency !== 'NGN') {
      review = `Paystack reported ${verified.currency} ${verified.amount / 100}, expected NGN ${payment.amount / 100}.`;
    } else if (order!.status === 'cancelled') {
      review = 'Money received for a cancelled order. Refund or restore the order.';
    } else if (!(UNPAID as readonly string[]).includes(order!.status)) {
      review = 'This order was already paid. The customer may have paid twice.';
    }

    await tx
      .update(schema.payments)
      .set({
        status: review ? 'needs_review' : 'success',
        reviewReason: review,
        reportedAmount: verified.amount !== payment.amount ? verified.amount : null,
        method: verified.channel,
        paidAt,
        providerData,
      })
      .where(eq(schema.payments.id, payment.id));

    if (review) {
      await recordEvent(tx, businessId, {
        type: 'payment.needs_review',
        actor: { type: 'system' },
        orderId: order!.id,
        customerId: order!.customerId,
        payload: {
          orderNumber: order!.orderNumber,
          reference: payment.reference,
          amount: verified.amount,
          reason: review,
        },
      });
      return 'needs_review';
    }

    await tx
      .update(schema.orders)
      .set({
        status: 'paid',
        amountPaid: order!.amountPaid + payment.amount,
        paymentMethod: 'paystack',
        paidAt,
      })
      .where(eq(schema.orders.id, order!.id));
    await recordEvent(tx, businessId, {
      type: 'payment.confirmed',
      actor: { type: 'system' },
      orderId: order!.id,
      customerId: order!.customerId,
      payload: {
        orderNumber: order!.orderNumber,
        amount: payment.amount,
        method: verified.channel,
        reference: payment.reference,
      },
    });
    return 'confirmed';
  });
}

/** Records a manual payment row (cash, checked transfer, POS) inside markOrderPaid's transaction. */
export async function recordManualPayment(
  tx: Tx,
  businessId: string,
  input: { orderId: string; amount: number; method: string; note: string; createdBy: string },
): Promise<void> {
  await tx.insert(schema.payments).values({
    businessId,
    orderId: input.orderId,
    provider: 'manual',
    reference: `MAN-${randomBytes(8).toString('hex')}`,
    amount: input.amount,
    status: 'success',
    method: input.method,
    paidAt: new Date(),
    providerData: input.note ? { note: input.note } : {},
    createdBy: input.createdBy,
  });
}

/** Payments that need the owner's attention. */
export async function listPaymentsNeedingReview(actor: ActorContext): Promise<schema.Payment[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, EDITORS);
    return tx
      .select()
      .from(schema.payments)
      .where(inArray(schema.payments.status, ['needs_review']))
      .orderBy(desc(schema.payments.createdAt));
  });
}
