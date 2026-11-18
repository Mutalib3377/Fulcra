/** Browser-safe billing rules (B1): plans, what they include, and plan status. */

/** Feature keys checked before a module or channel action runs (rule 6). */
export const FEATURE_KEYS = [
  'storefront',
  'agent',
  'channel.whatsapp',
  'channel.instagram',
  'channel.web_widget',
  'payments',
  'catalog_import',
  'catalog_import.shops',
  'owner_alerts',
  'customer_messages',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const CHANNEL_FEATURES = [
  'channel.whatsapp',
  'channel.instagram',
  'channel.web_widget',
] as const;

export const PLAN_CODES = ['starter', 'growth', 'pro'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  /** Kobo a month; annual = 10 months (two free). */
  monthlyPrice: number;
  annualPrice: number;
  /** Assistant conversations a month. */
  conversationsPerMonth: number;
  /** How many of WhatsApp, Instagram and website chat can be connected at once. */
  channels: number;
  features: FeatureKey[];
  summary: string;
};

const CORE: FeatureKey[] = [
  'storefront',
  'agent',
  'payments',
  'catalog_import',
  'customer_messages',
];
const ALL_CHANNELS: FeatureKey[] = [...CHANNEL_FEATURES];

/**
 * The plans. Prices and limits are starting points to test with sellers (PRODUCT_PLAN §8):
 * change them here. Conversation limits must stay below what the AI costs per plan.
 */
export const PLANS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: 'starter',
    name: 'Starter',
    monthlyPrice: 1_250_000,
    annualPrice: 12_500_000,
    conversationsPerMonth: 150,
    channels: 1,
    features: [...CORE, ...ALL_CHANNELS],
    summary: 'Your store or website, payments, and the assistant on one channel.',
  },
  growth: {
    code: 'growth',
    name: 'Growth',
    monthlyPrice: 2_500_000,
    annualPrice: 25_000_000,
    conversationsPerMonth: 500,
    channels: 3,
    features: [...CORE, ...ALL_CHANNELS, 'owner_alerts', 'catalog_import.shops'],
    summary: 'All channels, WhatsApp alerts and daily briefing, and shop imports.',
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    monthlyPrice: 5_000_000,
    annualPrice: 50_000_000,
    conversationsPerMonth: 1_500,
    channels: 3,
    features: [...CORE, ...ALL_CHANNELS, 'owner_alerts', 'catalog_import.shops'],
    summary: 'Everything in Growth, more conversations, and new modules as they launch.',
  },
};

export const TRIAL_DAYS = 14;
/** The trial includes this plan's features (minus TRIAL_EXCLUDED_FEATURES)… */
export const TRIAL_PLAN: PlanCode = 'growth';
/** …with fewer assistant chats, so free trials can't run up a large AI bill. */
export const TRIAL_CONVERSATIONS = 100;
/**
 * Not in the trial because each one costs Fulcra money: owner alerts and briefings are sent from
 * Fulcra's own WhatsApp number. During the trial everything still shows on the dashboard.
 * Fulcra staff can switch them on for one business (`setBusinessEntitlement`).
 */
export const TRIAL_EXCLUDED_FEATURES: FeatureKey[] = ['owner_alerts'];
/** After a failed renewal, features keep working this long. */
export const GRACE_DAYS = 7;
/** What still works without a paid plan: sales and data never stop, the AI does. */
export const INACTIVE_FEATURES: FeatureKey[] = ['storefront', 'payments', 'catalog_import'];

/** The cheapest plan that includes a feature (for "upgrade" messages). */
export function planFor(feature: FeatureKey): PlanDefinition {
  return PLAN_CODES.map((c) => PLANS[c]).find((p) => p.features.includes(feature)) ?? PLANS.pro;
}

export type EffectiveStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

/**
 * Where a subscription really stands now (dates decide, no job needed): a trial or paid
 * period that ran out has ended; a renewal that didn't arrive is "payment problem" until the
 * grace period ends.
 */
export function effectiveStatus(
  sub: {
    status: EffectiveStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    graceEndsAt: Date | null;
  },
  now = new Date(),
): EffectiveStatus {
  const t = now.getTime();
  switch (sub.status) {
    case 'trialing':
      return sub.trialEndsAt && sub.trialEndsAt.getTime() > t ? 'trialing' : 'expired';
    case 'active': {
      if (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > t) return 'active';
      const grace = sub.currentPeriodEnd.getTime() + GRACE_DAYS * 86_400_000;
      return t < grace ? 'past_due' : 'expired';
    }
    case 'past_due':
      return sub.graceEndsAt && sub.graceEndsAt.getTime() > t ? 'past_due' : 'expired';
    case 'cancelled':
      return sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > t ? 'cancelled' : 'expired';
    default:
      return 'expired';
  }
}

/** Trial, paid, cancelled-but-paid-until, or within grace: the plan's features work. */
export function isActiveStatus(status: EffectiveStatus): boolean {
  return status !== 'expired';
}

export const STATUS_LABELS: Record<EffectiveStatus, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment problem',
  cancelled: 'Cancelled (until the end of the paid period)',
  expired: 'Ended',
};
