import { randomUUID } from 'node:crypto';
import { schema, withSystem, withTenant } from '@fulcra/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireMember, type ActorContext } from '../members/access';
import { getPaystackClient, type PaystackVerifiedTransaction } from '../payments/paystack';
import { dashboardUrl } from '../payments/urls';
import { CoreError } from '../shared/errors';
import { planStateInTx } from './entitlements';
import { PLAN_CODES, PLANS, type PlanCode } from './rules';

/**
 * Paying for Fulcra (B1b, docs/decisions/0019): Paystack subscriptions on Fulcra's own
 * account (never a seller's subaccount). Checkout starts a plan; renewals, failed payments
 * and cancellations come back as Paystack webhooks. Every payment is verified with Paystack
 * and checked against the plan's price before a plan turns on.
 */

const sub = schema.subscriptions;
type Interval = schema.BillingInterval;
const priceOf = (code: PlanCode, interval: Interval) =>
  interval === 'annual' ? PLANS[code].annualPrice : PLANS[code].monthlyPrice;

// ─── Plans at Paystack ───────────────────────────────────────────────────────

/**
 * Worker start: the plans table matches `PLANS`, and each plan/interval exists at Paystack.
 * A changed price gets a new Paystack plan (existing subscribers keep the old price).
 * Returns how many Paystack plans were created.
 */
export async function syncBillingPlans(): Promise<number> {
  const rows = await withSystem((tx) => tx.select().from(schema.plans));
  for (const code of PLAN_CODES) {
    const p = PLANS[code];
    const row = rows.find((r) => r.code === code);
    if (!row) {
      await withSystem((tx) =>
        tx.insert(schema.plans).values({
          code,
          name: p.name,
          monthlyPrice: p.monthlyPrice,
          annualPrice: p.annualPrice,
        }),
      );
    } else if (
      row.monthlyPrice !== p.monthlyPrice ||
      row.annualPrice !== p.annualPrice ||
      row.name !== p.name
    ) {
      await withSystem((tx) =>
        tx
          .update(schema.plans)
          .set({
            name: p.name,
            monthlyPrice: p.monthlyPrice,
            annualPrice: p.annualPrice,
            ...(row.monthlyPrice !== p.monthlyPrice ? { paystackMonthlyPlanCode: null } : {}),
            ...(row.annualPrice !== p.annualPrice ? { paystackAnnualPlanCode: null } : {}),
          })
          .where(eq(schema.plans.code, code)),
      );
    }
  }
  const missing = await withSystem((tx) =>
    tx
      .select()
      .from(schema.plans)
      .where(
        or(
          isNull(schema.plans.paystackMonthlyPlanCode),
          isNull(schema.plans.paystackAnnualPlanCode),
        ),
      ),
  );
  if (missing.length === 0) return 0;
  const paystack = getPaystackClient();
  let created = 0;
  for (const row of missing) {
    for (const interval of ['monthly', 'annual'] as const) {
      const column = interval === 'monthly' ? 'paystackMonthlyPlanCode' : 'paystackAnnualPlanCode';
      if (row[column]) continue;
      const { planCode } = await paystack.createPlan({
        name: `Fulcra ${row.name} (${interval === 'monthly' ? 'monthly' : 'yearly'})`,
        amount: interval === 'monthly' ? row.monthlyPrice : row.annualPrice,
        interval: interval === 'monthly' ? 'monthly' : 'annually',
      });
      await withSystem((tx) =>
        tx
          .update(schema.plans)
          .set({ [column]: planCode })
          .where(eq(schema.plans.code, row.code)),
      );
      created++;
    }
  }
  return created;
}

async function paystackPlanCode(code: PlanCode, interval: Interval): Promise<string> {
  const [row] = await withSystem((tx) =>
    tx.select().from(schema.plans).where(eq(schema.plans.code, code)).limit(1),
  );
  const planCode =
    interval === 'annual' ? row?.paystackAnnualPlanCode : row?.paystackMonthlyPlanCode;
  if (!planCode)
    throw new CoreError(
      'conflict',
      'Online payment for plans is not set up yet. Please try again later.',
    );
  return planCode;
}

/** Which of our plans a Paystack plan code is (system lookup: Fulcra-wide table). */
async function planFromPaystackCode(
  planCode: string,
): Promise<{ code: PlanCode; interval: Interval } | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select()
      .from(schema.plans)
      .where(
        or(
          eq(schema.plans.paystackMonthlyPlanCode, planCode),
          eq(schema.plans.paystackAnnualPlanCode, planCode),
        ),
      )
      .limit(1),
  );
  if (!row || !(PLAN_CODES as readonly string[]).includes(row.code)) return null;
  return {
    code: row.code as PlanCode,
    interval: row.paystackAnnualPlanCode === planCode ? 'annual' : 'monthly',
  };
}

// ─── The owner chooses a plan ────────────────────────────────────────────────

export const choosePlanInput = z.object({
  plan: z.enum(PLAN_CODES),
  interval: z.enum(['monthly', 'annual']),
});

export type ChoosePlanResult =
  { kind: 'checkout'; url: string } | { kind: 'scheduled'; startsAt: Date };

/**
 * The owner picks a plan. No paid plan yet, or a bigger one: Paystack checkout now (an
 * upgrade replaces the old plan as soon as it is paid). A smaller plan while paying: it
 * starts on the saved card when the paid period ends, and the current plan stops renewing.
 */
export async function choosePlan(
  actor: ActorContext,
  input: z.input<typeof choosePlanInput>,
): Promise<ChoosePlanResult> {
  const { plan, interval } = choosePlanInput.parse(input);
  const current = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [row] = await tx.select().from(sub).limit(1);
    const [owner] = await tx
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.userId, actor.userId))
      .limit(1);
    return { row, state: await planStateInTx(tx), email: owner?.email ?? '' };
  });
  const paying =
    current.row?.status !== 'trialing' &&
    (current.state.status === 'active' || current.state.status === 'past_due');
  if (paying && !current.row?.paystackSubscriptionCode)
    throw new CoreError(
      'conflict',
      'Your plan is still being set up with Paystack. Please try again in a minute.',
    );
  if (paying && current.row!.planCode === plan && current.row!.interval === interval)
    throw new CoreError('conflict', 'You are already on this plan.');

  const smaller =
    paying &&
    priceOf(plan, interval) / (interval === 'annual' ? 12 : 1) <
      priceOf(current.row!.planCode as PlanCode, current.row!.interval) /
        (current.row!.interval === 'annual' ? 12 : 1);
  const paystack = getPaystackClient();
  const planCode = await paystackPlanCode(plan, interval);

  if (smaller && current.row) {
    const row = current.row;
    if (!row.paystackAuthorizationCode || !row.paystackCustomerCode || !row.currentPeriodEnd)
      throw new CoreError(
        'conflict',
        'We can’t switch you automatically. Cancel your plan, then choose the new one when it ends.',
      );
    if (row.paystackSubscriptionCode && row.paystackEmailToken)
      await paystack.disableSubscription({
        code: row.paystackSubscriptionCode,
        token: row.paystackEmailToken,
      });
    const next = await paystack.createSubscription({
      customerCode: row.paystackCustomerCode,
      planCode,
      authorizationCode: row.paystackAuthorizationCode,
      startDate: row.currentPeriodEnd,
    });
    await withTenant(actor.businessId, (tx) =>
      tx
        .update(sub)
        .set({
          pendingPlanCode: plan,
          paystackSubscriptionCode: next.subscriptionCode,
          paystackEmailToken: next.emailToken,
        })
        .where(eq(sub.businessId, actor.businessId)),
    );
    return { kind: 'scheduled', startsAt: row.currentPeriodEnd };
  }

  if (!current.email)
    throw new CoreError('conflict', 'Your account has no email address for the receipt.');
  const reference = `sub_${randomUUID().replace(/-/g, '')}`;
  const checkout = await paystack.initializePlanCheckout({
    email: current.email,
    amount: priceOf(plan, interval),
    planCode,
    reference,
    callbackUrl: dashboardUrl('/settings/billing?paid=1'),
    metadata: { kind: 'fulcra_subscription', businessId: actor.businessId, plan, interval },
  });
  return { kind: 'checkout', url: checkout.authorizationUrl };
}

/** Stops the plan renewing (owner). Features keep working until the end of the paid period. */
export async function cancelPlan(actor: ActorContext): Promise<void> {
  const row = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    const [r] = await tx.select().from(sub).limit(1);
    return r;
  });
  if (!row || (row.status !== 'active' && row.status !== 'past_due'))
    throw new CoreError('conflict', 'You have no paid plan to cancel.');
  if (row.paystackSubscriptionCode && row.paystackEmailToken)
    await getPaystackClient().disableSubscription({
      code: row.paystackSubscriptionCode,
      token: row.paystackEmailToken,
    });
  await withTenant(actor.businessId, (tx) =>
    tx
      .update(sub)
      .set({ status: 'cancelled', pendingPlanCode: null })
      .where(eq(sub.businessId, actor.businessId)),
  );
}

// ─── Paystack webhooks ───────────────────────────────────────────────────────

export const SUBSCRIPTION_EVENTS = [
  'subscription.create',
  'subscription.disable',
  'subscription.not_renew',
  'invoice.payment_failed',
  'invoice.create',
  'invoice.update',
] as const;

const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Whether a Paystack webhook is about Fulcra's own subscriptions. */
export function isSubscriptionWebhook(event: string, data: Record<string, unknown>): boolean {
  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(event)) return true;
  if (event !== 'charge.success') return false;
  return (
    obj(data.metadata).kind === 'fulcra_subscription' || Boolean(str(obj(data.plan).plan_code))
  );
}

/** Which business a subscription event is for (system lookup across businesses, 0003). */
async function findSubscription(by: {
  businessId?: string;
  customerCode?: string;
  subscriptionCode?: string;
}) {
  const conditions = [
    by.businessId ? eq(sub.businessId, by.businessId) : undefined,
    by.subscriptionCode ? eq(sub.paystackSubscriptionCode, by.subscriptionCode) : undefined,
    by.customerCode ? eq(sub.paystackCustomerCode, by.customerCode) : undefined,
  ].filter(Boolean);
  for (const condition of conditions) {
    const [row] = await withSystem((tx) => tx.select().from(sub).where(condition).limit(1));
    if (row) return row;
  }
  return null;
}

function addPeriod(from: Date, interval: Interval): Date {
  const d = new Date(from);
  if (interval === 'annual') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** A subscription webhook that came before its payment; the worker retries it. */
export class SubscriptionNotLinkedYet extends Error {
  constructor(code: string) {
    super(`Subscription ${code} is not linked to a business yet`);
    this.name = 'SubscriptionNotLinkedYet';
  }
}

export type SubscriptionWebhookResult =
  'activated' | 'already_recorded' | 'updated' | 'ignored' | 'needs_review';

/**
 * Applies a subscription webhook (worker). Payments are verified with Paystack first; the
 * amount must match the plan. Each payment reference is recorded once (rule 9).
 */
export async function processSubscriptionWebhook(
  event: string,
  data: Record<string, unknown>,
  verify: (reference: string) => Promise<PaystackVerifiedTransaction>,
): Promise<SubscriptionWebhookResult> {
  if (event === 'charge.success') {
    const reference = str(data.reference);
    if (!reference) return 'ignored';
    const verified = await verify(reference);
    if (verified.status !== 'success' || verified.currency !== 'NGN') return 'needs_review';
    const raw = verified.raw;
    const metadata = { ...obj(data.metadata), ...obj(raw.metadata) };
    const planCode = str(obj(raw.plan).plan_code) ?? str(obj(data.plan).plan_code) ?? str(raw.plan);
    const plan = planCode ? await planFromPaystackCode(planCode) : null;
    if (!plan) return 'needs_review';
    if (verified.amount < priceOf(plan.code, plan.interval)) return 'needs_review';
    const customerCode = verified.customerCode ?? str(obj(raw.customer).customer_code);
    const row = await findSubscription({
      businessId: typeof metadata.businessId === 'string' ? metadata.businessId : undefined,
      customerCode,
    });
    if (!row) return 'needs_review';
    const paidAt = verified.paidAt ? new Date(verified.paidAt) : new Date();
    const authorization = obj(raw.authorization);
    const reusable =
      authorization.reusable === true ? str(authorization.authorization_code) : undefined;
    const fromCheckout = metadata.kind === 'fulcra_subscription';
    // An upgrade through checkout: the old subscription stops renewing.
    const replacing =
      fromCheckout && row.paystackSubscriptionCode && row.paystackEmailToken
        ? { code: row.paystackSubscriptionCode, token: row.paystackEmailToken }
        : null;
    const result = await withTenant(row.businessId, async (tx) => {
      const inserted = await tx
        .insert(schema.subscriptionPayments)
        .values({
          businessId: row.businessId,
          reference,
          planCode: plan.code,
          interval: plan.interval,
          amount: verified.amount,
          paidAt,
          periodEnd: addPeriod(paidAt, plan.interval),
        })
        .onConflictDoNothing()
        .returning({ id: schema.subscriptionPayments.id });
      if (inserted.length === 0) return 'already_recorded' as const;
      await tx
        .update(sub)
        .set({
          planCode: plan.code,
          interval: plan.interval,
          status: 'active',
          currentPeriodEnd: addPeriod(paidAt, plan.interval),
          graceEndsAt: null,
          pendingPlanCode: row.pendingPlanCode === plan.code ? null : row.pendingPlanCode,
          ...(customerCode ? { paystackCustomerCode: customerCode } : {}),
          ...(reusable ? { paystackAuthorizationCode: reusable } : {}),
          // Only forget the replaced subscription (never one linked meanwhile).
          ...(replacing
            ? {
                paystackSubscriptionCode: sql`case when ${sub.paystackSubscriptionCode} = ${replacing.code} then null else ${sub.paystackSubscriptionCode} end`,
                paystackEmailToken: sql`case when ${sub.paystackSubscriptionCode} = ${replacing.code} then null else ${sub.paystackEmailToken} end`,
              }
            : {}),
        })
        .where(eq(sub.businessId, row.businessId));
      return 'activated' as const;
    });
    if (result === 'activated' && replacing) {
      try {
        await getPaystackClient().disableSubscription(replacing);
      } catch (error) {
        console.error('[billing] could not stop the old subscription', error);
      }
    }
    return result;
  }

  const subscriptionCode =
    str(data.subscription_code) ?? str(obj(data.subscription).subscription_code);
  const customerCode = str(obj(data.customer).customer_code);
  if (event === 'subscription.create') {
    if (!subscriptionCode) return 'ignored';
    const row = await findSubscription({ subscriptionCode, customerCode });
    // It can arrive before the payment that tells us whose customer this is (or, on an
    // upgrade, before that payment switched the plan): retry shortly.
    if (!row) throw new SubscriptionNotLinkedYet(subscriptionCode);
    const forPlan = str(obj(data.plan).plan_code);
    const plan = forPlan ? await planFromPaystackCode(forPlan) : null;
    if (plan && plan.code !== row.planCode && plan.code !== row.pendingPlanCode)
      throw new SubscriptionNotLinkedYet(subscriptionCode);
    const next = str(data.next_payment_date);
    await withTenant(row.businessId, (tx) =>
      tx
        .update(sub)
        .set({
          paystackSubscriptionCode: subscriptionCode,
          ...(str(data.email_token) ? { paystackEmailToken: str(data.email_token) } : {}),
          ...(customerCode ? { paystackCustomerCode: customerCode } : {}),
          // A downgrade's subscription starts later: don't move the current period.
          ...(next && !row.pendingPlanCode ? { currentPeriodEnd: new Date(next) } : {}),
        })
        .where(eq(sub.businessId, row.businessId)),
    );
    return 'updated';
  }
  if (!subscriptionCode) return 'ignored';
  const row = await findSubscription({ subscriptionCode });
  // Events for a subscription we already replaced (upgrade/downgrade) don't matter.
  if (!row || row.paystackSubscriptionCode !== subscriptionCode) return 'ignored';
  if (event === 'invoice.payment_failed') {
    await withTenant(row.businessId, (tx) =>
      tx
        .update(sub)
        .set({ status: 'past_due', graceEndsAt: new Date(Date.now() + 7 * 86_400_000) })
        .where(eq(sub.businessId, row.businessId)),
    );
    return 'updated';
  }
  if (event === 'subscription.disable' || event === 'subscription.not_renew') {
    if (row.status === 'active' || row.status === 'past_due') {
      await withTenant(row.businessId, (tx) =>
        tx
          .update(sub)
          .set({ status: 'cancelled' })
          .where(and(eq(sub.businessId, row.businessId))),
      );
      return 'updated';
    }
  }
  return 'ignored';
}
