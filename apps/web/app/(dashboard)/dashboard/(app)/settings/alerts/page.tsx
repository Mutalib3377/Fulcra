import { getOwnerAlertSettings, listRecentOwnerAlerts, platformAlertsStatus } from '@fulcra/core';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { AlertsForm } from './alerts-form';

export const metadata: Metadata = { title: 'Alerts' };

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'Waiting to send', tone: 'bg-muted text-muted-foreground' },
  sent: { label: 'Sent', tone: 'bg-muted text-muted-foreground' },
  delivered: { label: 'Delivered', tone: 'bg-success-soft text-success' },
  read: { label: 'Read', tone: 'bg-success-soft text-success' },
  failed: { label: 'Not delivered', tone: 'bg-danger-soft text-danger' },
  not_sent: { label: 'Not sent', tone: 'bg-warning-soft text-warning' },
};

const KIND: Record<string, string> = {
  paid_order: 'Paid order',
  low_stock: 'Low stock',
  unmatched_payment: 'Payment to check',
  waiting_customer: 'Customer waiting',
  briefing: 'Daily briefing',
  test: 'Test alert',
};

export default async function AlertsSettingsPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Alert settings are for the owner and staff.</p>;
  }
  const [settings, recent, platform] = await Promise.all([
    getOwnerAlertSettings(actor),
    listRecentOwnerAlerts(actor),
    platformAlertsStatus(),
  ]);
  const time = (d: Date) =>
    d.toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Alerts</h1>
        <p className="text-muted-foreground">
          Fulcra tells you on WhatsApp when something needs you, and sends a short summary every
          morning.
        </p>
      </div>
      {!platform.configured ? (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          Fulcra’s WhatsApp number isn’t set up yet, so alerts are listed below but not sent.
        </p>
      ) : platform.approved < platform.total ? (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          WhatsApp is still approving Fulcra’s alert messages. Alerts are sent as soon as they are
          approved.
        </p>
      ) : null}
      <AlertsForm initial={settings} canEdit={membership.role === 'owner'} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent alerts</CardTitle>
          <CardDescription>The last 20 alerts and briefings.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recent.map((alert) => (
                <li key={alert.id} className="flex flex-col gap-1 rounded-md bg-muted/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {KIND[alert.kind] ?? alert.kind} · {time(alert.createdAt)}
                    </span>
                    <Badge className={STATUS[alert.status]?.tone}>
                      {STATUS[alert.status]?.label ?? alert.status}
                    </Badge>
                  </div>
                  <p className="text-sm break-words text-muted-foreground">{alert.text}</p>
                  {alert.error && <p className="text-xs text-warning">{alert.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
