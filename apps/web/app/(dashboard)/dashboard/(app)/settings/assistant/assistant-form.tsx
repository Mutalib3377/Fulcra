'use client';

import { WEEKDAYS, type AgentSettingsView } from '@fulcra/core/rules';
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
  Textarea,
} from '@fulcra/ui';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { saveAgentSettingsAction } from './actions';

const DAY_LABEL = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
} as const;
type Day = (typeof WEEKDAYS)[number];
type DayHours = { open: boolean; from: string; to: string };

function toDays(hours: AgentSettingsView['businessHours']): Record<Day, DayHours> {
  return Object.fromEntries(
    WEEKDAYS.map((d) => {
      const slot = hours?.[d]?.[0];
      return [
        d,
        slot
          ? { open: true, from: slot[0], to: slot[1] }
          : { open: !hours && d !== 'sun', from: '09:00', to: '18:00' },
      ];
    }),
  ) as Record<Day, DayHours>;
}

export function AssistantForm({
  initial,
  canEdit,
}: {
  initial: AgentSettingsView;
  canEdit: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [alwaysOpen, setAlwaysOpen] = useState(initial.businessHours === null);
  const [days, setDays] = useState(() => toDays(initial.businessHours));
  const [afterHoursOrders, setAfterHoursOrders] = useState(initial.afterHoursOrders);
  const [awayMessage, setAwayMessage] = useState(initial.awayMessage);
  const [greeting, setGreeting] = useState(initial.greeting);
  const [policies, setPolicies] = useState(initial.policies);
  const [topics, setTopics] = useState(initial.handoffTopics.join(', '));
  const [payLink, setPayLink] = useState(initial.paymentOptions.includes('link'));
  const [payTransfer, setPayTransfer] = useState(initial.paymentOptions.includes('transfer'));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const setDay = (day: Day, patch: Partial<DayHours>) =>
    setDays((all) => ({ ...all, [day]: { ...all[day], ...patch } }));

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    start(async () => {
      const result = await saveAgentSettingsAction({
        enabled,
        businessHours: alwaysOpen
          ? null
          : Object.fromEntries(
              WEEKDAYS.map((d) => [d, days[d].open ? [[days[d].from, days[d].to]] : []]),
            ),
        afterHoursOrders,
        awayMessage,
        greeting,
        policies,
        handoffTopics: topics
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        paymentOptions: [
          ...(payLink ? (['link'] as const) : []),
          ...(payTransfer ? (['transfer'] as const) : []),
        ],
      });
      setMessage(
        result.ok
          ? {
              ok: true,
              text: enabled ? 'Saved. Your assistant is on.' : 'Saved. Your assistant is off.',
            }
          : { ok: false, text: result.message },
      );
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <p className="font-semibold">Assistant {enabled ? 'on' : 'off'}</p>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? 'It answers new messages for you.'
                  : 'Messages wait for your team in the inbox.'}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Assistant on" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Opening hours</CardTitle>
            <CardDescription>Lagos time.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-4">
              <span>Open all the time</span>
              <Switch
                checked={alwaysOpen}
                onCheckedChange={setAlwaysOpen}
                aria-label="Open all the time"
              />
            </label>
            {!alwaysOpen && (
              <ul className="flex flex-col gap-2">
                {WEEKDAYS.map((d) => (
                  <li key={d} className="flex flex-wrap items-center gap-2">
                    <label className="flex w-32 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={days[d].open}
                        onChange={(e) => setDay(d, { open: e.target.checked })}
                      />
                      {DAY_LABEL[d]}
                    </label>
                    {days[d].open ? (
                      <span className="flex items-center gap-1 text-sm">
                        <Input
                          type="time"
                          aria-label={`${DAY_LABEL[d]} opens`}
                          value={days[d].from}
                          onChange={(e) => setDay(d, { from: e.target.value })}
                          className="w-28"
                        />
                        –
                        <Input
                          type="time"
                          aria-label={`${DAY_LABEL[d]} closes`}
                          value={days[d].to}
                          onChange={(e) => setDay(d, { to: e.target.value })}
                          className="w-28"
                        />
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-center justify-between gap-4 border-t pt-3">
              <span className="text-sm">
                <span className="font-medium">Keep selling when closed</span>
                <span className="block text-muted-foreground">
                  The assistant still answers and takes orders; your team follows up when you open.
                </span>
              </span>
              <Switch
                checked={afterHoursOrders}
                onCheckedChange={setAfterHoursOrders}
                aria-label="Keep selling when closed"
              />
            </label>
            {!afterHoursOrders && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="away">Away message</Label>
                <Textarea
                  id="away"
                  rows={2}
                  maxLength={500}
                  placeholder="Thanks for your message! We're closed now and will reply from 9am."
                  value={awayMessage}
                  onChange={(e) => setAwayMessage(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How customers pay</CardTitle>
            <CardDescription>
              What the assistant offers after an order. Payments confirm themselves either way.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm">
                <span className="font-medium">Payment link</span>
                <span className="block text-muted-foreground">
                  A page where they pay by card, bank transfer or USSD.
                </span>
              </span>
              <Switch checked={payLink} onCheckedChange={setPayLink} aria-label="Payment link" />
            </label>
            <label className="flex items-center justify-between gap-4 border-t pt-3">
              <span className="text-sm">
                <span className="font-medium">Bank transfer</span>
                <span className="block text-muted-foreground">
                  The customer’s own account number to transfer into.
                </span>
              </span>
              <Switch
                checked={payTransfer}
                onCheckedChange={setPayTransfer}
                aria-label="Bank transfer"
              />
            </label>
            {!payLink && !payTransfer && (
              <p role="alert" className="text-sm text-danger">
                Choose at least one way for customers to pay.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What your assistant should know</CardTitle>
            <CardDescription>
              Its tone comes from your brand kit. Prices, stock and delivery fees always come from
              your catalog.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="policies">Your policies</Label>
              <Textarea
                id="policies"
                rows={4}
                maxLength={3000}
                placeholder="E.g. Returns within 3 days if unworn. Delivery takes 1–2 days in Lagos. We don't do pay on delivery."
                value={policies}
                onChange={(e) => setPolicies(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="greeting">Greeting (optional)</Label>
              <Input
                id="greeting"
                maxLength={300}
                placeholder="Welcome to Ada Styles! How can I help you today?"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="topics">Always ask me about</Label>
              <Input
                id="topics"
                placeholder="discounts, custom orders, bulk orders"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separate with commas. The assistant passes these chats to your team.
              </p>
            </div>
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
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button type="submit" loading={pending}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Only the owner can change these settings.</p>
        )}
        <Link
          href="/inbox/test"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Try your assistant in the test chat
        </Link>
      </div>
    </form>
  );
}
