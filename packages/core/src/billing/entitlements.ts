import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CoreError } from '../shared/errors';
import {
  CHANNEL_FEATURES,
  effectiveStatus,
  FEATURE_KEYS,
  INACTIVE_FEATURES,
  isActiveStatus,
  planFor,
  PLANS,
  TRIAL_CONVERSATIONS,
  TRIAL_DAYS,
  TRIAL_EXCLUDED_FEATURES,
  TRIAL_PLAN,
  type EffectiveStatus,
  type FeatureKey,
  type PlanCode,
  type PlanDefinition,
} from './rules';

export type PlanState = {
  plan: PlanDefinition;
  status: EffectiveStatus;
  active: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pendingPlanCode: PlanCode | null;
  /** Assistant conversations allowed this month (plan, or Fulcra's override). */
  conversationLimit: number;
  /** Features this business can use now, before the one-channel rule. */
  features: Set<FeatureKey>;
};

const asPlan = (code: string | null | undefined): PlanCode =>
  code === 'starter' || code === 'growth' || code === 'pro' ? code : TRIAL_PLAN;

/** The business's plan and what it includes right now (inside the caller's transaction). */
export async function planStateInTx(tx: Tx, now = new Date()): Promise<PlanState> {
  const [sub] = await tx.select().from(schema.subscriptions).limit(1);
  const [business] = await tx
    .select({ createdAt: schema.businesses.createdAt })
    .from(schema.businesses)
    .limit(1);
  // A business without a row (created before billing) is on its trial from sign-up.
  const row = sub ?? {
    planCode: TRIAL_PLAN,
    status: 'trialing' as const,
    trialEndsAt: new Date((business?.createdAt ?? now).getTime() + TRIAL_DAYS * 86_400_000),
    currentPeriodEnd: null,
    graceEndsAt: null,
    pendingPlanCode: null,
  };
  const status = effectiveStatus(row, now);
  const active = isActiveStatus(status);
  const plan = PLANS[status === 'trialing' ? TRIAL_PLAN : asPlan(row.planCode)];
  const trialing = status === 'trialing';
  const features = new Set<FeatureKey>(active ? plan.features : INACTIVE_FEATURES);
  if (trialing) for (const f of TRIAL_EXCLUDED_FEATURES) features.delete(f);
  const overrides = await tx.select().from(schema.entitlements);
  let conversationLimit = trialing ? TRIAL_CONVERSATIONS : plan.conversationsPerMonth;
  for (const o of overrides) {
    if (o.featureKey === 'agent.conversations' && o.limitValue !== null)
      conversationLimit = o.limitValue;
    const key = o.featureKey as FeatureKey;
    if (!FEATURE_KEYS.includes(key) || o.enabled === null) continue;
    if (o.enabled) features.add(key);
    else features.delete(key);
  }
  return {
    plan,
    status,
    active,
    trialEndsAt: row.trialEndsAt,
    currentPeriodEnd: row.currentPeriodEnd,
    pendingPlanCode: row.pendingPlanCode ? asPlan(row.pendingPlanCode) : null,
    conversationLimit,
    features,
  };
}

/** Whether connecting this channel keeps the business within its plan's number of channels. */
async function channelAllowedInTx(tx: Tx, state: PlanState, feature: FeatureKey): Promise<boolean> {
  if (!(CHANNEL_FEATURES as readonly string[]).includes(feature)) return true;
  const channel = feature === 'channel.web_widget' ? 'web' : feature.slice('channel.'.length);
  const [others] = await tx
    .select({ n: sql<number>`count(distinct ${schema.channelConnections.channel})::int` })
    .from(schema.channelConnections)
    .where(
      and(
        eq(schema.channelConnections.mode, 'live'),
        eq(schema.channelConnections.status, 'connected'),
        ne(schema.channelConnections.channel, channel as schema.Channel),
      ),
    );
  return (others?.n ?? 0) < state.plan.channels;
}

/**
 * Whether a business may use a feature now (rule 6): its plan (or trial), Fulcra's switches
 * for that business, and — for channels — how many its plan allows at once.
 */
export async function canUse(businessId: string, feature: FeatureKey): Promise<boolean> {
  return (await featureAccess(businessId, feature)).allowed;
}

export type FeatureAccess = { allowed: boolean; message: string | null };

/** Like canUse, with the plain reason when not allowed (shown to the owner). */
export async function featureAccess(
  businessId: string,
  feature: FeatureKey,
): Promise<FeatureAccess> {
  const id = z.uuid().parse(businessId);
  return withTenant(id, (tx) => featureAccessInTx(tx, feature));
}

export async function featureAccessInTx(tx: Tx, feature: FeatureKey): Promise<FeatureAccess> {
  const state = await planStateInTx(tx);
  if (!state.features.has(feature)) {
    if (!state.active)
      return {
        allowed: false,
        message:
          'Your Fulcra plan has ended. Choose a plan in Settings → Billing to turn this back on.',
      };
    if (state.status === 'trialing' && TRIAL_EXCLUDED_FEATURES.includes(feature))
      return {
        allowed: false,
        message:
          'WhatsApp alerts start when you choose a plan. During your free trial, new orders, low stock and chats waiting all show on your dashboard.',
      };
    const needed = planFor(feature);
    return {
      allowed: false,
      message: `This is part of the ${needed.name} plan. Upgrade in Settings → Billing to use it.`,
    };
  }
  if (!(await channelAllowedInTx(tx, state, feature))) {
    return {
      allowed: false,
      message: `Your ${state.plan.name} plan includes ${state.plan.channels === 1 ? 'one channel' : `${state.plan.channels} channels`}. Disconnect the other one, or upgrade to Growth to use all channels.`,
    };
  }
  return { allowed: true, message: null };
}

/** Throws a plain "upgrade" error when the feature isn't in the business's plan. */
export async function requireFeatureInTx(tx: Tx, feature: FeatureKey): Promise<void> {
  const access = await featureAccessInTx(tx, feature);
  if (!access.allowed)
    throw new CoreError('forbidden', access.message ?? 'Not included in your plan.');
}

/**
 * Fulcra staff only (support scripts): switch a feature on or off for one business, or give
 * it a different conversation limit (`agent.conversations`). Null clears the change.
 */
export async function setBusinessEntitlement(
  businessId: string,
  featureKey: FeatureKey | 'agent.conversations',
  change: { enabled?: boolean | null; limitValue?: number | null; note?: string },
): Promise<void> {
  const id = z.uuid().parse(businessId);
  await withTenant(id, (tx) =>
    tx
      .insert(schema.entitlements)
      .values({
        businessId: id,
        featureKey,
        enabled: change.enabled ?? null,
        limitValue: change.limitValue ?? null,
        note: change.note ?? '',
      })
      .onConflictDoUpdate({
        target: [schema.entitlements.businessId, schema.entitlements.featureKey],
        set: {
          enabled: change.enabled ?? null,
          limitValue: change.limitValue ?? null,
          note: change.note ?? '',
        },
      }),
  );
}
