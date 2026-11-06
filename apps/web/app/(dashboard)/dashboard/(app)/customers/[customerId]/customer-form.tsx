'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FieldMessage,
  Input,
  Label,
  NativeSelect,
  Switch,
  Textarea,
} from '@fulcra/ui';
import { CheckCircle2 } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';
import { updateCustomerAction } from '../actions';

type Values = {
  name: string;
  phone: string;
  email: string;
  address: string;
  deliveryZoneId: string;
  tags: string;
  notes: string;
  marketingOptIn: boolean;
};

export function CustomerForm({
  customerId,
  initial,
  zones,
  canEdit,
}: {
  customerId: string;
  initial: Values;
  zones: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; field?: string } | null>(
    null,
  );
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = () =>
    startTransition(async () => {
      const res = await updateCustomerAction(customerId, {
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address,
        deliveryZoneId: values.deliveryZoneId || null,
        tags: values.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: values.notes,
        marketingOptIn: values.marketingOptIn,
      });
      setResult(
        res.ok
          ? { ok: true, message: 'Saved.' }
          : { ok: false, message: res.message, ...(res.field ? { field: res.field } : {}) },
      );
    });

  const err = (field: string) =>
    result && !result.ok && result.field === field ? (
      <FieldMessage error>{result.message}</FieldMessage>
    ) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={!canEdit} className="flex flex-col gap-3">
          <Field label="Name" id="c-name">
            {
              <Input
                id="c-name"
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
              />
            }
            {err('name')}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" id="c-phone">
              {
                <Input
                  id="c-phone"
                  type="tel"
                  inputMode="tel"
                  value={values.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              }
              {err('phone')}
            </Field>
            <Field label="Email (optional)" id="c-email">
              {
                <Input
                  id="c-email"
                  type="email"
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              }
              {err('email')}
            </Field>
          </div>
          <Field label="Address" id="c-address">
            <Textarea
              id="c-address"
              rows={2}
              value={values.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
          {zones.length > 0 && (
            <Field label="Delivery area" id="c-zone">
              <NativeSelect
                id="c-zone"
                value={values.deliveryZoneId}
                onChange={(e) => set('deliveryZoneId', e.target.value)}
              >
                <option value="">Not set</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Tags (separate with commas)" id="c-tags">
            <Input
              id="c-tags"
              placeholder="e.g. VIP, Wholesale"
              value={values.tags}
              onChange={(e) => set('tags', e.target.value)}
            />
          </Field>
          <Field label="Notes" id="c-notes">
            <Textarea
              id="c-notes"
              rows={3}
              placeholder="e.g. Prefers evening delivery"
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between gap-3">
            <span>Happy to receive offers and news</span>
            <Switch
              checked={values.marketingOptIn}
              onCheckedChange={(v) => set('marketingOptIn', v)}
              aria-label="Happy to receive offers and news"
            />
          </label>
          {result && !result.field && (
            <p
              role={result.ok ? 'status' : 'alert'}
              className={
                result.ok ? 'flex items-center gap-2 text-sm text-success' : 'text-sm text-danger'
              }
            >
              {result.ok && <CheckCircle2 className="size-4" aria-hidden />} {result.message}
            </p>
          )}
          {canEdit && (
            <Button type="button" loading={pending} onClick={save}>
              Save details
            </Button>
          )}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
