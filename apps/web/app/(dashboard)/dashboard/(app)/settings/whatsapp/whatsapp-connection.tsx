'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@fulcra/ui';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { connectWhatsAppAction, disconnectWhatsAppAction } from './actions';

type Connection = {
  id: string;
  displayName: string;
  status: 'connected' | 'error' | 'disconnected';
  lastError: string | null;
  phoneNumberId: string;
};

export function WhatsAppConnection({
  connection,
  canEdit,
}: {
  connection: Connection | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(!connection);
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [form, setForm] = useState({ phoneNumberId: '', businessAccountId: '', accessToken: '' });
  const [current, setCurrent] = useState(connection);

  const field = (name: keyof typeof form, label: string, hint: string, type = 'text') => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type={type}
        inputMode={type === 'text' ? 'numeric' : undefined}
        autoComplete="off"
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
        aria-invalid={error?.field === name || undefined}
        aria-describedby={`${name}-hint`}
      />
      <p id={`${name}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error?.field === name && <p className="text-sm text-danger">{error.message}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {current && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {current.status === 'connected' ? (
                <CheckCircle2 className="size-5 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="size-5 text-warning" aria-hidden />
              )}
              <CardTitle>
                {current.status === 'connected' ? 'Connected' : 'Needs attention'}
              </CardTitle>
            </div>
            <CardDescription>
              {current.displayName || `Phone number ID ${current.phoneNumberId}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {current.status === 'error' && current.lastError && (
              <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                {current.lastError} Connect it again below with a new access token.
              </p>
            )}
            {current.status === 'connected' && (
              <p className="text-sm text-muted-foreground">
                Customers who message this number appear in your{' '}
                <Link href="/inbox" className="font-medium text-primary underline-offset-4">
                  inbox
                </Link>
                . Your assistant answers them when it is on.
              </p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {!editing && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Change details
                  </Button>
                )}
                <Button
                  variant="ghost"
                  loading={pending}
                  onClick={() => {
                    if (
                      !window.confirm('Disconnect this WhatsApp number? Chats stay in your inbox.')
                    )
                      return;
                    start(async () => {
                      const result = await disconnectWhatsAppAction(current.id);
                      if (!result.ok) return setError({ message: result.message });
                      setCurrent(null);
                      setEditing(true);
                    });
                  }}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!canEdit && !current && (
        <p className="text-muted-foreground">Ask the business owner to connect WhatsApp.</p>
      )}

      {canEdit && editing && (
        <Card>
          <CardHeader>
            <CardTitle>Connect with your Meta details</CardTitle>
            <CardDescription>
              For now, numbers are connected with details from your Meta developer app (WhatsApp →
              API Setup). This also works with Meta’s free test number. A one-tap “Connect WhatsApp”
              button is coming.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  setError(null);
                  const result = await connectWhatsAppAction(form);
                  if (!result.ok) return setError({ message: result.message, field: result.field });
                  setCurrent({
                    id: result.data.id,
                    displayName: result.data.displayName,
                    status: 'connected',
                    lastError: null,
                    phoneNumberId: form.phoneNumberId.trim(),
                  });
                  setForm({ phoneNumberId: '', businessAccountId: '', accessToken: '' });
                  setEditing(false);
                });
              }}
            >
              {field('phoneNumberId', 'Phone number ID', 'A long number shown under “From”.')}
              {field(
                'businessAccountId',
                'WhatsApp Business Account ID',
                'Shown on the same page, under the phone number ID.',
              )}
              {field(
                'accessToken',
                'Access token',
                'Use a permanent token from a system user for real use. Meta’s temporary token stops working after 24 hours. Stored encrypted.',
                'password',
              )}
              {error && !error.field && (
                <p role="alert" className="text-sm text-danger">
                  {error.message}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={pending}>
                  Check and connect
                </Button>
                {current && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
