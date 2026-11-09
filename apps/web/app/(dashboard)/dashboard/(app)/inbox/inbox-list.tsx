'use client';

import { CHANNEL_LABELS } from '@fulcra/core/rules';
import { Badge, Button, EmptyState, ErrorState, Skeleton, cn } from '@fulcra/ui';
import { useQuery } from '@tanstack/react-query';
import { Bot, MessageCircle, User } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { fetchJson, type InboxItem } from './types';

const FILTERS = [
  { key: 'attention', label: 'Needs you' },
  { key: 'all', label: 'All' },
  { key: 'agent', label: 'Assistant' },
  { key: 'human', label: 'Team' },
] as const;

function when(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

/** Chats, newest first, checked every 10 seconds. */
export function InboxList() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['inbox', 'list', filter],
    queryFn: () => fetchJson<InboxItem[]>(`/api/inbox/conversations?filter=${filter}`),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Filter chats" className="flex gap-2 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm whitespace-nowrap',
              filter === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
            )}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-label="Loading chats">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Chats could not load"
          description="Check your connection."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState
          title={filter === 'attention' ? 'Nothing waiting for you' : 'No chats yet'}
          description={
            filter === 'attention'
              ? 'Chats that need a reply from your team show here.'
              : 'Messages from WhatsApp, Instagram and your website will appear here. Try it with the test chat.'
          }
          action={
            <Button asChild variant="outline">
              <Link href="/inbox/test">Open test chat</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {data.map((item) => (
            <li key={item.id}>
              <Link
                href={`/inbox/${item.id}`}
                className="flex items-start gap-3 px-3 py-3 hover:bg-muted/50"
              >
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary">
                  {(item.customerName || item.customerPhone || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('truncate', item.unreadCount > 0 ? 'font-bold' : 'font-medium')}
                    >
                      {item.customerName || item.customerPhone || 'Customer'}
                    </span>
                    {item.isTest && <Badge tone="info">Test</Badge>}
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {when(item.lastMessageAt)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'truncate text-sm',
                      item.unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {item.lastMessagePreview}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3" aria-hidden />{' '}
                      {CHANNEL_LABELS[item.channel] ?? item.channel}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      {item.handledBy === 'agent' ? (
                        <Bot className="size-3" aria-hidden />
                      ) : (
                        <User className="size-3" aria-hidden />
                      )}
                      {item.handledBy === 'agent' ? 'Assistant' : 'Team'}
                    </span>
                    {item.needsAttention && (
                      <Badge tone="warning">{item.attentionReason ?? 'Needs you'}</Badge>
                    )}
                    {item.unreadCount > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                        {item.unreadCount}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
