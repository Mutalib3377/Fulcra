import { formatNaira } from '@fulcra/config';
import { adminOverview } from '@fulcra/core';
import { Card } from '@fulcra/ui';
import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/page-header';
import { formatUsd, requireAdminPage } from '@/lib/admin';

export const dynamic = 'force-dynamic';

function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
}) {
  const body = (
    <Card className="flex h-full flex-col gap-1 p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Admin home: sign-ups, plans, money in, what it costs us, and whether the system is healthy. */
export default async function AdminOverviewPage() {
  const admin = await requireAdminPage();
  const o = await adminOverview(admin);
  const profit = o.thisMonth.subscriptionIncome - o.thisMonth.costNaira;
  const checks = [
    ['Database', o.health.checks.database],
    ['Background jobs', o.health.checks.queue],
    ['Webhooks', o.health.checks.webhooks],
  ] as const;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        description="All sellers on Fulcra. Months and days are Lagos time."
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Sellers</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="All sellers" value={o.businesses.total} href="/admin/sellers" />
          <Stat label="New today" value={o.businesses.today} />
          <Stat label="New in 7 days" value={o.businesses.last7} />
          <Stat label="New in 30 days" value={o.businesses.last30} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Plans</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="On free trial"
            value={o.plans.trialing}
            href="/admin/sellers?status=trialing"
          />
          <Stat
            label="Paying"
            value={o.plans.paying}
            hint={`Starter ${o.plans.byPlan.starter} · Growth ${o.plans.byPlan.growth} · Pro ${o.plans.byPlan.pro}${o.plans.givenFree ? ` · ${o.plans.givenFree} given free` : ''}`}
            href="/admin/sellers?status=paying"
          />
          <Stat
            label="Trial or plan ended"
            value={o.plans.expired}
            href="/admin/sellers?status=expired"
          />
          <Stat
            label="Monthly recurring"
            value={formatNaira(o.plans.monthlyRecurring)}
            hint="Plans that renew, per month"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">This month</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Plan payments received"
            value={formatNaira(o.thisMonth.subscriptionIncome)}
          />
          <Stat
            label="AI and WhatsApp costs"
            value={formatNaira(o.thisMonth.costNaira)}
            hint={`${formatUsd(o.thisMonth.costUsd.total)} (AI ${formatUsd(o.thisMonth.costUsd.ai)}, WhatsApp ${formatUsd(o.thisMonth.costUsd.whatsapp)}) at ₦${o.thisMonth.usdToNaira.toLocaleString('en-NG')}/$`}
          />
          <Stat
            label="Income after those costs"
            value={
              <span className={profit < 0 ? 'text-danger' : 'text-success'}>
                {formatNaira(profit)}
              </span>
            }
            hint="Hosting and Paystack fees not included"
          />
          <Stat
            label="Sellers' sales through Fulcra"
            value={formatNaira(o.thisMonth.sellerSales)}
            hint={`${o.thisMonth.sellerOrders} paid orders`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">System</h2>
        <Card className="divide-y divide-border">
          {checks.map(([label, check]) => (
            <div key={label} className="flex items-center gap-3 px-4 py-3">
              {check.ok ? (
                <CheckCircle2 className="size-5 text-success" aria-hidden />
              ) : (
                <XCircle className="size-5 text-danger" aria-hidden />
              )}
              <span className="font-medium">{label}</span>
              <span className="ml-auto text-sm text-muted-foreground">{check.detail}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
