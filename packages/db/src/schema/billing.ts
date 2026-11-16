import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, tenantPolicy, timestamps } from './_shared';
import { businesses } from './businesses';

/**
 * Fulcra's plans (B1). What each plan includes lives in code (`@fulcra/core` billing rules);
 * this table keeps the prices charged and Paystack's plan codes. Fulcra-wide: no tenant
 * policy, system access only (decision 0003).
 */
export const plans = pgTable('plans', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** Kobo. */
  monthlyPrice: integer('monthly_price').notNull(),
  annualPrice: integer('annual_price').notNull(),
  paystackMonthlyPlanCode: text('paystack_monthly_plan_code'),
  paystackAnnualPlanCode: text('paystack_annual_plan_code'),
  ...timestamps,
}).enableRLS();

export const subscriptionStatuses = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export const subscriptionStatus = pgEnum('subscription_status', subscriptionStatuses);
export const billingIntervals = ['monthly', 'annual'] as const;
export const billingInterval = pgEnum('billing_interval', billingIntervals);

/** Each business's plan and where its payments stand. One row per business. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    businessId: uuid('business_id')
      .primaryKey()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    planCode: text('plan_code').notNull(),
    interval: billingInterval('interval').notNull().default('monthly'),
    status: subscriptionStatus('status').notNull().default('trialing'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** Paid until (active), or ends then (cancelled). */
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    /** After a failed renewal: features keep working until then. */
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    /** A downgrade waiting for the end of the paid period. */
    pendingPlanCode: text('pending_plan_code'),
    paystackCustomerCode: text('paystack_customer_code'),
    paystackSubscriptionCode: text('paystack_subscription_code'),
    /** Needed by Paystack to stop a subscription; secret-ish, never shown. */
    paystackEmailToken: text('paystack_email_token'),
    /** Saved card authorization, to start a downgraded plan without a new checkout. */
    paystackAuthorizationCode: text('paystack_authorization_code'),
    ...timestamps,
  },
  (t) => [
    index('subscriptions_paystack_subscription_idx').on(t.paystackSubscriptionCode),
    index('subscriptions_paystack_customer_idx').on(t.paystackCustomerCode),
    tenantPolicy('subscriptions', t.businessId),
  ],
).enableRLS();

/**
 * Per-business switches on top of the plan, e.g. a feature turned off for one business, or
 * extra conversations given by Fulcra. Null = no change from the plan.
 */
export const entitlements = pgTable(
  'entitlements',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    featureKey: text('feature_key').notNull(),
    enabled: boolean('enabled'),
    /** A different limit (e.g. conversations a month) for this business. */
    limitValue: integer('limit_value'),
    note: text('note').notNull().default(''),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('entitlements_business_feature_unique').on(t.businessId, t.featureKey),
    tenantPolicy('entitlements', t.businessId),
  ],
).enableRLS();

/** Subscription payments to Fulcra (the invoice list). Each Paystack reference once. */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: id(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    planCode: text('plan_code').notNull(),
    interval: billingInterval('interval').notNull(),
    /** Kobo. */
    amount: integer('amount').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('subscription_payments_reference_unique').on(t.reference),
    index('subscription_payments_business_idx').on(t.businessId, t.paidAt),
    tenantPolicy('subscription_payments', t.businessId),
  ],
).enableRLS();

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];
export type BillingInterval = (typeof billingIntervals)[number];
export type Entitlement = typeof entitlements.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
