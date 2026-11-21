import { formatNaira } from '@fulcra/config';
import { adminActivity, adminGetBusiness, isCoreError } from '@fulcra/core';
import { Badge, Card, ListGroup, ListRow } from '@fulcra/ui';
import { ExternalLink } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { formatUsd, requireAdminPage } from '@/lib/admin';
import { formatDateTime, orderStatusLabel } from '@/lib/orders';
import { storeHost, storeUrl } from '@/lib/urls';
import { ActivityList } from '../../activity-list';
import { STATUS_LABEL, STATUS_TONE } from '../../status';
import { AdminControls } from './admin-controls';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ businessId: string }> };

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  web: 'Website chat',
};

/** One seller in full: plan and limits, team, channels, activity, costs and recent orders. */
export default async function AdminSellerPage({ params }: Props) {
  const admin = await requireAdminPage();
  const { businessId } = await params;
  const b = await adminGetBusiness(admin, businessId).catch((error) => {
    if (isCoreError(error) && error.code === 'not_found') notFound();
    throw error;
  });
  const activity = await adminActivity(admin, { businessId: b.id, limit: 30 });
  const date = (d: Date | null) => (d ? formatDateTime(d) : '—');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: '/admin/sellers', label: 'Sellers' }}
        title={b.name}
        description={`Joined ${formatDateTime(b.createdAt)} · ${b.category}`}
        actions={
          b.hasExternalWebsite ? null : (
            <a
              href={storeUrl(b.subdomain)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
            >
              {storeHost(b.subdomain)} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )
        }
      />

      {b.suspended ? (
        <div role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">
          <strong>Suspended</strong> on {formatDateTime(b.suspended.at)}: {b.suspended.reason}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Actions</h2>
        <AdminControls
          businessId={b.id}
          suspended={Boolean(b.suspended)}
          conversationLimit={b.plan.conversationLimit}
          ownerMessageLimit={b.plan.ownerMessageLimit}
        />
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">Plan</span>
          <span className="text-xl font-semibold">{b.plan.name}</span>
          <Badge tone={STATUS_TONE[b.plan.status]} className="self-start">
            {STATUS_LABEL[b.plan.status]}
          </Badge>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">Assistant chats this month</span>
          <span className="text-xl font-semibold">
            {b.thisMonth.chats}{' '}
            <span className="text-base font-normal text-muted-foreground">
              / {b.plan.conversationLimit}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {b.thisMonth.ownerMessages} / {b.plan.ownerMessageLimit} messages to Ask Fulcra
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">Sales this month</span>
          <span className="text-xl font-semibold">{formatNaira(b.thisMonth.sales)}</span>
          <span className="text-xs text-muted-foreground">
            {b.counts.paidOrders} paid of {b.counts.orders} orders in total
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-muted-foreground">Cost to Fulcra this month</span>
          <span className="text-xl font-semibold">{formatUsd(b.thisMonth.costUsdTotal)}</span>
          <span className="text-xs text-muted-foreground">AI and WhatsApp</span>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-6">
          <ListGroup title="Plan and dates">
            <ListRow
              title="Plan"
              trailing={`${b.plan.name}${b.plan.interval ? ` (${b.plan.interval})` : ''}`}
            />
            <ListRow title="Trial ends" trailing={date(b.plan.trialEndsAt)} />
            <ListRow title="Paid until" trailing={date(b.plan.currentPeriodEnd)} />
          </ListGroup>
          <ListGroup title="Business">
            <ListRow title="WhatsApp number" trailing={b.whatsappNumber} />
            <ListRow
              title="Sells on"
              trailing={b.hasExternalWebsite ? (b.websiteUrl ?? 'Own website') : 'Fulcra store'}
            />
            <ListRow
              title="Gets paid"
              trailing={b.payoutConfigured ? (b.payoutBankName ?? 'Set up') : 'Not set up'}
            />
            <ListRow
              title="Products · customers"
              trailing={`${b.counts.products} · ${b.counts.customers}`}
            />
          </ListGroup>
          <ListGroup title="Team">
            {b.team.map((m) => (
              <ListRow
                key={m.email}
                title={m.email}
                trailing={<Badge tone="neutral">{m.role}</Badge>}
              />
            ))}
          </ListGroup>
          <ListGroup title="Channels">
            {b.channels.length === 0 ? (
              <ListRow title="None connected yet" />
            ) : (
              b.channels.map((c, i) => (
                <ListRow
                  key={i}
                  title={`${CHANNEL_LABEL[c.channel] ?? c.channel}${c.mode === 'test' ? ' (test chat)' : ''}`}
                  description={c.name || undefined}
                  trailing={
                    <Badge tone={c.status === 'connected' ? 'success' : 'warning'}>
                      {c.status}
                    </Badge>
                  }
                />
              ))
            )}
          </ListGroup>
        </div>
        <div className="flex flex-col gap-6">
          <ListGroup
            title="Cost this month, by feature"
            footer="AI calls and WhatsApp messages Fulcra paid for."
          >
            {b.thisMonth.costUsd.length === 0 ? (
              <ListRow title="Nothing yet" />
            ) : (
              b.thisMonth.costUsd.map((c) => (
                <ListRow key={c.feature} title={c.feature} trailing={formatUsd(c.total)} />
              ))
            )}
          </ListGroup>
          <ListGroup
            title="Changes made by Fulcra"
            footer="Extra limits or features switched for this seller."
          >
            {b.overrides.length === 0 ? (
              <ListRow title="None" />
            ) : (
              b.overrides.map((e) => (
                <ListRow
                  key={e.featureKey}
                  title={e.featureKey}
                  description={e.note || undefined}
                  trailing={
                    e.limitValue !== null
                      ? `limit ${e.limitValue}`
                      : e.enabled === false
                        ? 'off'
                        : e.enabled
                          ? 'on'
                          : '—'
                  }
                />
              ))
            )}
          </ListGroup>
          <ListGroup title="Activity log" footer="Changes made from the admin area, newest first.">
            <ActivityList items={activity} showBusiness={false} />
          </ListGroup>
          <ListGroup title="Recent orders">
            {b.recentOrders.length === 0 ? (
              <ListRow title="No orders yet" />
            ) : (
              b.recentOrders.map((o) => (
                <ListRow
                  key={o.id}
                  title={`#${o.orderNumber} · ${formatNaira(o.total)}`}
                  description={`${formatDateTime(o.createdAt)} · ${o.channel}`}
                  trailing={orderStatusLabel(o.status as Parameters<typeof orderStatusLabel>[0])}
                />
              ))
            )}
          </ListGroup>
        </div>
      </div>
    </div>
  );
}
