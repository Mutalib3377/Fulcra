import { schema, withSystem, withTenant, type Tx } from '@fulcra/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { setBusinessEntitlementInTx } from '../billing/entitlements';
import {
  FEATURE_KEYS,
  PLANS,
  effectiveStatus,
  type FeatureKey,
  type PlanCode,
} from '../billing/rules';
import { CoreError } from '../shared/errors';
import { requireAdmin, type AdminActor } from './access';

/**
 * What Fulcra's staff can change for one seller (AD2, docs/decisions/0027). Every change needs
 * a short reason and is written to `admin_actions` (who, what, when, why) in the same
 * transaction as the change, so there is never a change without its record.
 */

const reason = z
  .string()
  .trim()
  .min(3, 'Write a short reason (it goes in the activity log).')
  .max(500);
const businessIdInput = z.uuid();

async function logAction(
  tx: Tx,
  admin: AdminActor,
  businessId: string,
  action: string,
  why: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(schema.adminActions).values({
    businessId,
    adminUserId: admin.userId,
    adminEmail: admin.email,
    action,
    details,
    reason: why,
  });
}

/** Runs a change for one business with its activity-log row, refusing unknown businesses. */
async function forBusiness<T>(
  admin: AdminActor,
  businessId: string,
  run: (tx: Tx, business: schema.Business) => Promise<T>,
): Promise<T> {
  requireAdmin(admin);
  const parsed = businessIdInput.safeParse(businessId);
  if (!parsed.success) throw new CoreError('not_found', 'This business does not exist.');
  return withTenant(parsed.data, async (tx) => {
    const [business] = await tx
      .select()
      .from(schema.businesses)
      .where(eq(schema.businesses.id, parsed.data))
      .for('update')
      .limit(1);
    if (!business) throw new CoreError('not_found', 'This business does not exist.');
    return run(tx, business);
  });
}

function parse<T extends z.ZodType>(schemaIn: T, input: unknown): z.output<T> {
  const result = schemaIn.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new CoreError('validation', issue.message, String(issue.path[0] ?? ''));
  }
  return result.data;
}

// ─── Trial ───────────────────────────────────────────────────────────────────

export const extendTrialInput = z.object({
  days: z.coerce.number().int().min(1, 'At least 1 day.').max(90, 'At most 90 days at a time.'),
  reason,
});

/**
 * Gives a seller more free-trial days: from the trial's end, or from today if it has ended.
 * Not for sellers on a paid plan (their plan dates come from Paystack).
 */
export async function adminExtendTrial(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof extendTrialInput>,
  now = new Date(),
): Promise<{ trialEndsAt: Date }> {
  const data = parse(extendTrialInput, input);
  return forBusiness(admin, businessId, async (tx, business) => {
    const [sub] = await tx.select().from(schema.subscriptions).limit(1);
    if (sub && sub.status !== 'trialing') {
      const status = effectiveStatus(sub, now);
      if (status !== 'expired')
        throw new CoreError(
          'conflict',
          'This seller is on a plan; a trial can only be extended before they pay.',
        );
    }
    const from = sub?.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
    const trialEndsAt = new Date(from.getTime() + data.days * 86_400_000);
    if (sub) {
      await tx
        .update(schema.subscriptions)
        .set({ status: 'trialing', trialEndsAt, currentPeriodEnd: null, graceEndsAt: null })
        .where(eq(schema.subscriptions.businessId, business.id));
    } else {
      await tx.insert(schema.subscriptions).values({
        businessId: business.id,
        planCode: 'growth',
        status: 'trialing',
        trialEndsAt,
      });
    }
    await logAction(tx, admin, business.id, 'extend_trial', data.reason, {
      days: data.days,
      trialEndsAt: trialEndsAt.toISOString(),
    });
    return { trialEndsAt };
  });
}

// ─── Free plan ───────────────────────────────────────────────────────────────

export const givePlanInput = z.object({
  planCode: z.enum(['starter', 'growth', 'pro']),
  months: z.coerce.number().int().min(1, 'At least 1 month.').max(24, 'At most 24 months.'),
  reason,
});

/**
 * Gives a seller a plan for free until a date (design partners, friends, a refund). Sellers
 * paying by card through Paystack are changed there instead, so their renewals stay right.
 */
export async function adminGivePlan(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof givePlanInput>,
  now = new Date(),
): Promise<{ planCode: PlanCode; until: Date }> {
  const data = parse(givePlanInput, input);
  return forBusiness(admin, businessId, async (tx, business) => {
    const [sub] = await tx.select().from(schema.subscriptions).limit(1);
    if (
      sub?.paystackSubscriptionCode &&
      ['active', 'past_due'].includes(effectiveStatus(sub, now))
    ) {
      throw new CoreError(
        'conflict',
        'This seller pays by card through Paystack. Cancel their plan first, or change it from their Billing page.',
      );
    }
    const until = new Date(now);
    until.setUTCMonth(until.getUTCMonth() + data.months);
    const values = {
      planCode: data.planCode,
      interval: 'monthly' as const,
      status: 'active' as const,
      currentPeriodEnd: until,
      graceEndsAt: null,
      pendingPlanCode: null,
      paystackSubscriptionCode: null,
    };
    if (sub) {
      await tx
        .update(schema.subscriptions)
        .set(values)
        .where(eq(schema.subscriptions.businessId, business.id));
    } else {
      await tx.insert(schema.subscriptions).values({ businessId: business.id, ...values });
    }
    await logAction(tx, admin, business.id, 'give_plan', data.reason, {
      planCode: data.planCode,
      plan: PLANS[data.planCode].name,
      months: data.months,
      until: until.toISOString(),
    });
    return { planCode: data.planCode, until };
  });
}

// ─── Limits and features ─────────────────────────────────────────────────────

export const ADMIN_LIMIT_KEYS = ['agent.conversations', 'owner.messages'] as const;
export type AdminLimitKey = (typeof ADMIN_LIMIT_KEYS)[number];

export const setLimitInput = z.object({
  key: z.enum(ADMIN_LIMIT_KEYS),
  /** Null goes back to the plan's own limit. */
  limit: z.coerce.number().int().min(0).max(100_000).nullable(),
  reason,
});

/** A different monthly limit for one seller (assistant chats or Ask Fulcra messages). */
export async function adminSetLimit(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof setLimitInput>,
): Promise<void> {
  const data = parse(setLimitInput, input);
  await forBusiness(admin, businessId, async (tx, business) => {
    await setBusinessEntitlementInTx(tx, business.id, data.key, {
      limitValue: data.limit,
      note: data.limit === null ? '' : `Admin: ${data.reason}`,
    });
    await logAction(tx, admin, business.id, 'set_limit', data.reason, {
      key: data.key,
      limit: data.limit,
    });
  });
}

export const setFeatureInput = z.object({
  feature: z.enum(FEATURE_KEYS),
  /** True: on even if the plan lacks it; false: off; null: as the plan says. */
  enabled: z.boolean().nullable(),
  reason,
});

/** Switches one feature on or off for one seller, or back to what their plan includes. */
export async function adminSetFeature(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof setFeatureInput>,
): Promise<void> {
  const data = parse(setFeatureInput, input);
  await forBusiness(admin, businessId, async (tx, business) => {
    await setBusinessEntitlementInTx(tx, business.id, data.feature as FeatureKey, {
      enabled: data.enabled,
      note: data.enabled === null ? '' : `Admin: ${data.reason}`,
    });
    await logAction(tx, admin, business.id, 'set_feature', data.reason, {
      feature: data.feature,
      enabled: data.enabled,
    });
  });
}

// ─── Suspension ──────────────────────────────────────────────────────────────

export const suspendInput = z.object({ reason });

/**
 * Suspends a seller: the store shows "temporarily unavailable"; the assistant, alerts and
 * automatic messages stop. Their data and dashboard stay. Returns the store address so the
 * caller can refresh the store's cache.
 */
export async function adminSuspend(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof suspendInput>,
  now = new Date(),
): Promise<{ subdomain: string }> {
  const data = parse(suspendInput, input);
  return forBusiness(admin, businessId, async (tx, business) => {
    if (business.suspendedAt) throw new CoreError('conflict', 'This seller is already suspended.');
    await tx
      .update(schema.businesses)
      .set({ suspendedAt: now, suspendedReason: data.reason })
      .where(eq(schema.businesses.id, business.id));
    await logAction(tx, admin, business.id, 'suspend', data.reason);
    return { subdomain: business.subdomain };
  });
}

/** Lifts a suspension: everything works again as their plan allows. */
export async function adminUnsuspend(
  admin: AdminActor,
  businessId: string,
  input: z.input<typeof suspendInput>,
): Promise<{ subdomain: string }> {
  const data = parse(suspendInput, input);
  return forBusiness(admin, businessId, async (tx, business) => {
    if (!business.suspendedAt) throw new CoreError('conflict', 'This seller is not suspended.');
    await tx
      .update(schema.businesses)
      .set({ suspendedAt: null, suspendedReason: null })
      .where(eq(schema.businesses.id, business.id));
    await logAction(tx, admin, business.id, 'unsuspend', data.reason, {
      wasSuspendedFor: business.suspendedReason,
    });
    return { subdomain: business.subdomain };
  });
}

// ─── Activity log ────────────────────────────────────────────────────────────

export type AdminActionView = Pick<
  schema.AdminAction,
  'id' | 'businessId' | 'adminEmail' | 'action' | 'details' | 'reason' | 'createdAt'
> & { businessName: string | null };

/** The latest admin changes, for one business or across all (system read, listed in 0003). */
export async function adminActivity(
  admin: AdminActor,
  filter: { businessId?: string; limit?: number } = {},
): Promise<AdminActionView[]> {
  requireAdmin(admin);
  const a = schema.adminActions;
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const businessId = filter.businessId ? businessIdInput.parse(filter.businessId) : null;
  return withSystem((tx) =>
    tx
      .select({
        id: a.id,
        businessId: a.businessId,
        adminEmail: a.adminEmail,
        action: a.action,
        details: a.details,
        reason: a.reason,
        createdAt: a.createdAt,
        businessName: schema.businesses.name,
      })
      .from(a)
      .leftJoin(schema.businesses, eq(schema.businesses.id, a.businessId))
      .where(businessId ? eq(a.businessId, businessId) : undefined)
      .orderBy(desc(a.createdAt))
      .limit(limit),
  );
}
