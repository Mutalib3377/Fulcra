'use client';

import { Button } from '@fulcra/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, useTransition } from 'react';
import { sendTemplateAction } from '../actions';
import { fetchJson } from '../types';

type Option = {
  purpose: 'reply_request' | 'payment_reminder';
  label: string;
  preview: string;
  available: boolean;
  reason: string | null;
};

/** When the 24-hour window has closed: the approved WhatsApp messages the team can send. */
export function TemplatePicker({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['inbox', 'templates', conversationId],
    queryFn: () => fetchJson<Option[]>(`/api/inbox/conversations/${conversationId}/templates`),
  });
  const [sending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3">
      <p className="text-sm">
        It’s been more than 24 hours since this customer last wrote, so WhatsApp only allows
        approved messages. Send one to invite them to reply:
      </p>
      {isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <p className="text-sm text-danger">These messages could not load. Check your connection.</p>
      )}
      {data?.map((option) => (
        <div key={option.purpose} className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{option.label}</span>
            <Button
              size="sm"
              disabled={!option.available || sending}
              loading={sending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await sendTemplateAction(conversationId, option.purpose);
                  if (!result.ok) return setError(result.message);
                  setDone(option.label);
                  onSent();
                })
              }
            >
              Send
            </Button>
          </div>
          {option.preview && <p className="text-sm text-muted-foreground">{option.preview}</p>}
          {option.reason && <p className="text-xs text-warning">{option.reason}</p>}
        </div>
      ))}
      {done && (
        <p role="status" className="text-sm text-success">
          Sent “{done}”. You can reply freely once the customer answers.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
