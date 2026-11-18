import { formatNaira } from '@fulcra/config';
import { getBillingSummary, PLAN_CODES, PLANS, STATUS_LABELS } from '@fulcra/core';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { CancelPlanButton, PlanButtons } from './plan-actions';
import { BackLink } from '@/components/page-header';

export const metadata: Metadata = { title: 'Plans and billing' };

const date = (d: Date) =>
  d.toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/** Whole days from now until a date (0 when past). */
function daysUntil(d: Date): number {
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string }>;
}) {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Billing is for the owner and staff.</p>;
  }
  const billing = await getBillingSummary(actor);
  const { paid } = await searchParams;
  const isOwner = membership.role === 'owner';
  const paying = billing.status === 'active' || billing.status === 'past_due';
  const monthly = (code: keyof typeof PLANS) => PLANS[code].monthlyPrice;
  const modeFor = (code: keyof typeof PLANS) =>
    !paying
      ? ('choose' as const)
      : code === billing.planCode
        ? ('current' as const)
        : monthly(code) > monthly(billing.planCode)
          ? ('upgrade' as const)
          : ('downgrade' as const);
  const { used, limit } = billing.usage;
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const daysLeft = billing.trialEndsAt ? daysUntil(billing.trialEndsAt) : 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <BackLink href="/settings">Settings</BackLink>
        <h1 className="text-3xl font-semibold">Plans and billing</h1>
      </div>
      {paid && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          Thank you! Your payment is being confirmed. Your plan turns on in a moment (refresh this
          page).
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              {billing.status === 'trialing'
                ? `Free trial (${billing.planName})`
                : billing.planName}
            </CardTitle>
            <Badge tone={billing.active ? 'success' : 'danger'}>
              {STATUS_LABELS[billing.status]}
            </Badge>
          </div>
          <CardDescription>
            {billing.status === 'trialing' && billing.trialEndsAt
              ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left — your trial ends on ${date(billing.trialEndsAt)}. It includes everything in Growth.`
              : billing.status === 'expired'
                ? 'Your store, orders and payments still work. The assistant, alerts and automatic customer messages are paused until you choose a plan.'
                : billing.currentPeriodEnd
                  ? `${billing.status === 'cancelled' ? 'Ends' : 'Renews'} on ${date(billing.currentPeriodEnd)}.`
                  : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Assistant chats this month</span>
            <span>
              {used} of {limit}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Assistant chats used this month"
            aria-valuenow={used}
            aria-valuemin={0}
            aria-valuemax={limit}
          >
            <div
              className={`h-full ${percent >= 100 ? 'bg-danger' : percent >= 80 ? 'bg-warning' : 'bg-primary'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {billing.pendingPlanCode && (
            <p className="text-sm">
              Switching to {PLANS[billing.pendingPlanCode].name} when this period ends.
            </p>
          )}
          {isOwner && paying && <CancelPlanButton />}
          <p className="text-xs text-muted-foreground">
            A chat counts once a month, however many messages it has. Chats your team answers don’t
            count. When the limit is reached, new chats come to you instead.
          </p>
        </CardContent>
      </Card>

      <h2 className="mt-2 text-lg font-semibold">Plans</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {PLAN_CODES.map((code) => {
          const plan = PLANS[code];
          const current =
            billing.status !== 'trialing' && billing.active && billing.planCode === code;
          return (
            <Card key={code} className={current ? 'border-primary' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {current && <Badge tone="success">Your plan</Badge>}
                </div>
                <p className="text-xl font-semibold">
                  {formatNaira(plan.monthlyPrice)}
                  <span className="text-sm font-normal text-muted-foreground"> / month</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  or {formatNaira(plan.annualPrice)} a year (2 months free)
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>{plan.summary}</p>
                <p className="text-muted-foreground">
                  {plan.conversationsPerMonth.toLocaleString('en-NG')} assistant chats a month ·{' '}
                  {plan.channels === 1 ? '1 channel' : 'all channels'}
                </p>
                {isOwner && <PlanButtons plan={code} mode={modeFor(code)} planName={plan.name} />}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {isOwner
          ? 'You pay securely with Paystack (card, bank transfer or USSD). Upgrades start straight away; smaller plans start when your current one ends.'
          : 'Only the business owner can change the plan.'}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {billing.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {billing.invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {date(inv.paidAt)} ·{' '}
                    {PLANS[inv.planCode as keyof typeof PLANS]?.name ?? inv.planCode} (
                    {inv.interval === 'annual' ? 'yearly' : 'monthly'})
                  </span>
                  <span className="font-medium">{formatNaira(inv.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
