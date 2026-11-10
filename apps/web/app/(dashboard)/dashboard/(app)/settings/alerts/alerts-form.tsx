'use client';

import type { OwnerAlertSettingsView } from '@fulcra/core/rules';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from '@fulcra/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveAlertSettingsAction, sendTestAlertAction } from './actions';

type Toggle =
  | 'alertPaidOrders'
  | 'alertLowStock'
  | 'alertUnmatchedPayments'
  | 'alertWaitingCustomers'
  | 'briefingEnabled'
  | 'customerMessagesEnabled';

const ALERTS: { key: Toggle; label: string; hint: string }[] = [
  { key: 'alertPaidOrders', label: 'New paid order', hint: 'As soon as a payment is confirmed.' },
  { key: 'alertLowStock', label: 'Low stock', hint: 'When a product reaches its warning level.' },
  {
    key: 'alertUnmatchedPayments',
    label: 'Payment to check',
    hint: 'Money arrived that Fulcra could not match to an order.',
  },
  {
    key: 'alertWaitingCustomers',
    label: 'Customer waiting for you',
    hint: 'When the assistant passes a chat to you.',
  },
];

export function AlertsForm({
  initial,
  canEdit,
}: {
  initial: OwnerAlertSettingsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initial.ownerWhatsapp ?? '');
  const [toggles, setToggles] = useState<Record<Toggle, boolean>>({
    alertPaidOrders: initial.alertPaidOrders,
    alertLowStock: initial.alertLowStock,
    alertUnmatchedPayments: initial.alertUnmatchedPayments,
    alertWaitingCustomers: initial.alertWaitingCustomers,
    briefingEnabled: initial.briefingEnabled,
    customerMessagesEnabled: initial.customerMessagesEnabled,
  });
  const [briefingTime, setBriefingTime] = useState(initial.briefingTime);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const set = (key: Toggle) => (on: boolean) => setToggles((t) => ({ ...t, [key]: on }));

  const row = (key: Toggle, label: string, hint: string, first = false) => (
    <label
      key={key}
      className={`flex items-center justify-between gap-4 ${first ? '' : 'border-t pt-3'}`}
    >
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={toggles[key]} onCheckedChange={set(key)} aria-label={label} />
    </label>
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startSave(async () => {
          const result = await saveAlertSettingsAction({
            ownerWhatsapp: phone,
            briefingTime,
            ...toggles,
          });
          setMessage(
            result.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: result.message },
          );
          if (result.ok) router.refresh();
        });
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your WhatsApp number</CardTitle>
            <CardDescription>
              Your own number, where Fulcra sends alerts. Not the business number your customers
              message.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <Label htmlFor="ownerWhatsapp">WhatsApp number</Label>
            <Input
              id="ownerWhatsapp"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0803 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to stop all alerts. Each alert costs about ₦15.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ALERTS.map((a, i) => row(a.key, a.label, a.hint, i === 0))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily briefing</CardTitle>
            <CardDescription>
              Yesterday’s sales, orders waiting for payment, orders to send out, low stock and chats
              waiting for you, in one message.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {row(
              'briefingEnabled',
              'Send me a daily briefing',
              'Every day at the time below.',
              true,
            )}
            {toggles.briefingEnabled && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="briefingTime">Time (Lagos time)</Label>
                <Input
                  id="briefingTime"
                  type="time"
                  className="w-40"
                  value={briefingTime}
                  onChange={(e) => setBriefingTime(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messages to customers</CardTitle>
          </CardHeader>
          <CardContent>
            {row(
              'customerMessagesEnabled',
              'Automatic customer messages',
              'Order confirmations, receipts and delivery updates on WhatsApp (about ₦15 each).',
              true,
            )}
          </CardContent>
        </Card>
      </fieldset>

      {message && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-sm text-success' : 'text-sm text-danger'}
        >
          {message.text}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saving}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={testing}
            disabled={!initial.ownerWhatsapp}
            onClick={() =>
              startTest(async () => {
                setMessage(null);
                const result = await sendTestAlertAction();
                setMessage(
                  result.ok
                    ? { ok: true, text: 'Test alert on its way. It appears in the list below.' }
                    : { ok: false, text: result.message },
                );
                if (result.ok) setTimeout(() => router.refresh(), 2500);
              })
            }
          >
            Send a test alert
          </Button>
        </div>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">Only the owner can change alerts.</p>
      )}
    </form>
  );
}
