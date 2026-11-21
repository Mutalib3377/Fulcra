import { schema, withTenant } from '@fulcra/db';
import { desc } from 'drizzle-orm';
import { requireMember, type ActorContext } from '../members/access';
import { planStateInTx } from './entitlements';
import { conversationUsage } from './usage';
import type { EffectiveStatus, PlanCode } from './rules';

export type BillingSummary = {
  planCode: PlanCode;
  planName: string;
  status: EffectiveStatus;
  active: boolean;
  /** Suspended by Fulcra (AD2): the store is offline and the assistant paused. */
  suspended: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pendingPlanCode: PlanCode | null;
  usage: { used: number; limit: number; month: string };
  invoices: Pick<
    schema.SubscriptionPayment,
    'id' | 'reference' | 'planCode' | 'interval' | 'amount' | 'paidAt' | 'periodEnd'
  >[];
};

/** The business's plan, trial, this month's conversations and invoices (owner and staff). */
export async function getBillingSummary(
  actor: ActorContext,
  now = new Date(),
): Promise<BillingSummary> {
  const { state, invoices } = await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner', 'staff']);
    const state = await planStateInTx(tx, now);
    const invoices = await tx
      .select({
        id: schema.subscriptionPayments.id,
        reference: schema.subscriptionPayments.reference,
        planCode: schema.subscriptionPayments.planCode,
        interval: schema.subscriptionPayments.interval,
        amount: schema.subscriptionPayments.amount,
        paidAt: schema.subscriptionPayments.paidAt,
        periodEnd: schema.subscriptionPayments.periodEnd,
      })
      .from(schema.subscriptionPayments)
      .orderBy(desc(schema.subscriptionPayments.paidAt))
      .limit(24);
    return { state, invoices };
  });
  return {
    planCode: state.plan.code,
    planName: state.plan.name,
    status: state.status,
    active: state.active,
    suspended: state.suspended,
    trialEndsAt: state.trialEndsAt,
    currentPeriodEnd: state.currentPeriodEnd,
    pendingPlanCode: state.pendingPlanCode,
    usage: await conversationUsage(actor.businessId, now),
    invoices,
  };
}
