'use client';

import { FEATURE_KEYS } from '@fulcra/core/rules';
import { Button, Card, FieldMessage, Input, Label, NativeSelect, Textarea, cn } from '@fulcra/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import {
  extendTrialAction,
  givePlanAction,
  setFeatureAction,
  setLimitAction,
  suspendAction,
} from './actions';

type Panel = 'trial' | 'plan' | 'limits' | 'feature' | 'suspend' | null;

const FEATURE_LABELS: Record<string, string> = {
  storefront: 'Store',
  agent: 'Assistant',
  'channel.whatsapp': 'WhatsApp',
  'channel.instagram': 'Instagram',
  'channel.web_widget': 'Website chat',
  payments: 'Payments',
  catalog_import: 'Import products',
  'catalog_import.shops': 'Import from Shopify / WooCommerce',
  owner_alerts: 'WhatsApp alerts to the owner',
  customer_messages: 'Automatic customer messages',
  owner_assistant: 'Ask Fulcra',
};

/** The admin's changes for one seller: each needs a reason and lands in the activity log. */
export function AdminControls({
  businessId,
  suspended,
  conversationLimit,
  ownerMessageLimit,
}: {
  businessId: string;
  suspended: boolean;
  conversationLimit: number;
  ownerMessageLimit: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Panel>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [plan, setPlan] = useState<'starter' | 'growth' | 'pro'>('growth');
  const [months, setMonths] = useState('3');
  const [chats, setChats] = useState(String(conversationLimit));
  const [ownerMessages, setOwnerMessages] = useState(String(ownerMessageLimit));
  const [feature, setFeature] = useState<string>('agent');
  const [featureState, setFeatureState] = useState<'on' | 'off' | 'plan'>('off');

  const submit = (action: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await action();
      if (result.ok) {
        setMessage({ ok: true, text: done });
        setReason('');
        setOpen(null);
        router.refresh();
      } else setMessage({ ok: false, text: result.message ?? 'Something went wrong.' });
    });

  const reasonField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="admin-reason">Reason (kept in the activity log)</Label>
      <Textarea
        id="admin-reason"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Design partner, agreed on the phone"
      />
    </div>
  );

  const toggle = (panel: Exclude<Panel, null>, label: string, danger = false): ReactNode => (
    <Button
      type="button"
      variant={open === panel ? 'secondary' : danger ? 'outline' : 'outline'}
      size="sm"
      className={cn(danger && 'text-danger')}
      onClick={() => {
        setMessage(null);
        setOpen(open === panel ? null : panel);
      }}
    >
      {label}
    </Button>
  );

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2">
        {toggle('trial', 'Extend trial')}
        {toggle('plan', 'Give a plan')}
        {toggle('limits', 'Limits')}
        {toggle('feature', 'Switch a feature')}
        {toggle('suspend', suspended ? 'Lift suspension' : 'Suspend', !suspended)}
      </div>

      {open === 'trial' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-days">Extra days</Label>
            <Input
              id="admin-days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-32"
            />
          </div>
          {reasonField}
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              submit(
                () => extendTrialAction(businessId, Number(days), reason),
                `Trial extended by ${days} days.`,
              )
            }
            className="self-start"
          >
            Extend trial
          </Button>
        </div>
      ) : null}

      {open === 'plan' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-plan">Plan</Label>
              <NativeSelect
                id="admin-plan"
                value={plan}
                onChange={(e) => setPlan(e.target.value as typeof plan)}
              >
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-months">For how many months</Label>
              <Input
                id="admin-months"
                type="number"
                min={1}
                max={24}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Free of charge until then. Afterwards they choose a plan as usual.
          </p>
          {reasonField}
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              submit(() => givePlanAction(businessId, plan, Number(months), reason), 'Plan given.')
            }
            className="self-start"
          >
            Give plan
          </Button>
        </div>
      ) : null}

      {open === 'limits' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-chats">Assistant chats a month</Label>
              <Input
                id="admin-chats"
                type="number"
                min={0}
                value={chats}
                onChange={(e) => setChats(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-owner">Ask Fulcra messages a month</Label>
              <Input
                id="admin-owner"
                type="number"
                min={0}
                value={ownerMessages}
                onChange={(e) => setOwnerMessages(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Leave a box empty to go back to what their plan includes.
          </p>
          {reasonField}
          <Button
            type="button"
            disabled={pending}
            className="self-start"
            onClick={() =>
              submit(async () => {
                const a = await setLimitAction(
                  businessId,
                  'agent.conversations',
                  chats === '' ? null : Number(chats),
                  reason,
                );
                if (!a.ok) return a;
                return setLimitAction(
                  businessId,
                  'owner.messages',
                  ownerMessages === '' ? null : Number(ownerMessages),
                  reason,
                );
              }, 'Limits saved.')
            }
          >
            Save limits
          </Button>
        </div>
      ) : null}

      {open === 'feature' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-feature">Feature</Label>
              <NativeSelect
                id="admin-feature"
                value={feature}
                onChange={(e) => setFeature(e.target.value)}
              >
                {FEATURE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {FEATURE_LABELS[key] ?? key}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-feature-state">Set to</Label>
              <NativeSelect
                id="admin-feature-state"
                value={featureState}
                onChange={(e) => setFeatureState(e.target.value as typeof featureState)}
              >
                <option value="off">Off for this seller</option>
                <option value="on">On, even if their plan lacks it</option>
                <option value="plan">As their plan says</option>
              </NativeSelect>
            </div>
          </div>
          {reasonField}
          <Button
            type="button"
            disabled={pending}
            className="self-start"
            onClick={() =>
              submit(
                () =>
                  setFeatureAction(
                    businessId,
                    feature,
                    featureState === 'plan' ? null : featureState === 'on',
                    reason,
                  ),
                'Feature saved.',
              )
            }
          >
            Save
          </Button>
        </div>
      ) : null}

      {open === 'suspend' ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {suspended
              ? 'Their store comes back and the assistant, alerts and automatic messages start again.'
              : 'Their store shows "temporarily unavailable" and the assistant, alerts and automatic messages stop. Their dashboard and data stay. They see a notice in their dashboard.'}
          </p>
          {reasonField}
          <Button
            type="button"
            variant={suspended ? 'primary' : 'danger'}
            disabled={pending}
            className="self-start"
            onClick={() =>
              submit(
                () => suspendAction(businessId, !suspended, reason),
                suspended ? 'Suspension lifted.' : 'Seller suspended.',
              )
            }
          >
            {suspended ? 'Lift suspension' : 'Suspend seller'}
          </Button>
        </div>
      ) : null}

      {message ? (
        message.ok ? (
          <p role="status" className="text-sm font-medium text-success">
            {message.text}
          </p>
        ) : (
          <FieldMessage>{message.text}</FieldMessage>
        )
      ) : null}
    </Card>
  );
}
