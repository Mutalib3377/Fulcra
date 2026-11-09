'use client';

import { CHANNEL_LABELS } from '@fulcra/core/rules';
import { Badge, Button, ErrorState, Skeleton, Textarea } from '@fulcra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Send, User } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { sendReplyAction, setHandlerAction } from '../actions';
import { ChatBubble } from '../chat-bubble';
import { fetchJson, type ChatView as View } from '../types';

/** One chat, checked every 5 seconds while open. */
export function ChatView({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const key = ['inbox', 'chat', conversationId];
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => fetchJson<View>(`/api/inbox/conversations/${conversationId}`),
    refetchInterval: 5_000,
  });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [switching, startSwitch] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['inbox', 'attention'] });
  };

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading chat">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="ml-auto h-16 w-2/3" />
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        title="This chat could not load"
        description="Check your connection, or go back to the inbox."
        action={
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const { conversation, customer, connection, messages, window: replyWindow } = data;
  const human = conversation.handledBy === 'human';
  const switchTo = (handler: 'agent' | 'human') =>
    startSwitch(async () => {
      setError(null);
      const result = await setHandlerAction(conversationId, handler);
      if (!result.ok) setError(result.message);
      refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link href="/inbox" className="text-sm text-primary">
          ← Inbox
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{customer.name || customer.phone || 'Customer'}</h1>
          {connection.mode === 'test' && <Badge tone="info">Test</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {CHANNEL_LABELS[conversation.channel] ?? conversation.channel}
          {customer.phone ? ` · ${customer.phone}` : ''}
          {' · '}
          <Link
            href={`/customers/${customer.id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Customer details
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          {human ? <User className="size-4" aria-hidden /> : <Bot className="size-4" aria-hidden />}
          {human ? 'Your team is handling this chat.' : 'Your assistant is handling this chat.'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={switching}
          onClick={() => switchTo(human ? 'agent' : 'human')}
        >
          {human ? 'Give back to assistant' : 'Take over'}
        </Button>
        {!data.agentEnabled && (
          <p className="w-full text-xs text-muted-foreground">
            Your assistant is off for now, so customers’ messages wait for your team.
          </p>
        )}
      </div>

      <ol
        className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
        aria-label="Messages"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <li className="text-center text-sm text-muted-foreground">No messages yet.</li>
        )}
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} mine={message.direction === 'outbound'} />
        ))}
      </ol>
      <div ref={end} />

      {replyWindow.open ? (
        <form
          className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex items-end gap-2 rounded-lg border bg-background p-2 md:bottom-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (!body) return;
            startSend(async () => {
              setError(null);
              const result = await sendReplyAction(conversationId, body);
              if (!result.ok) return setError(result.message);
              setText('');
              refresh();
            });
          }}
        >
          <Textarea
            aria-label="Your reply"
            placeholder="Type a reply…"
            rows={2}
            value={text}
            maxLength={4096}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 flex-1 resize-none"
          />
          <Button type="submit" loading={sending} disabled={!text.trim()} aria-label="Send reply">
            <Send aria-hidden />
          </Button>
        </form>
      ) : (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          It’s been more than 24 hours since this customer last wrote. WhatsApp and Instagram only
          allow approved template messages now, so you can reply when they write again.
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
