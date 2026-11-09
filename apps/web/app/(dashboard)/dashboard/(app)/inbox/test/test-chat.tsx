'use client';

import { Button, Textarea } from '@fulcra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { sendTestMessageAction } from '../actions';
import { ChatBubble } from '../chat-bubble';
import { fetchJson, type ChatMessage } from '../types';

/** The pretend customer's phone. Messages go through the real pipeline (worker and all). */
export function TestChat() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['inbox', 'test-chat'],
    queryFn: () =>
      fetchJson<{ conversationId: string | null; messages: ChatMessage[] }>('/api/inbox/test-chat'),
    refetchInterval: 2_000,
  });
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const messages = data?.messages ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto flex w-full max-w-sm flex-col overflow-hidden rounded-3xl border-4 border-foreground/80 bg-muted/50 shadow-md">
        <div className="bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
          You are the customer
        </div>
        <ol
          className="flex min-h-72 flex-col gap-2 p-3"
          aria-label="Test messages"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <li className="m-auto text-center text-sm text-muted-foreground">
              Write a message as if you were a customer, e.g. “How much is the Ankara dress?”
            </li>
          )}
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message} mine={message.direction === 'inbound'} />
          ))}
        </ol>
        <div ref={end} />
        <form
          className="flex items-end gap-2 border-t bg-background p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (!body) return;
            start(async () => {
              setError(null);
              const result = await sendTestMessageAction(body);
              if (!result.ok) return setError(result.message);
              setText('');
              void queryClient.invalidateQueries({ queryKey: ['inbox'] });
            });
          }}
        >
          <Textarea
            aria-label="Message as the customer"
            placeholder="Message…"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 flex-1 resize-none"
          />
          <Button
            type="submit"
            loading={pending}
            disabled={!text.trim()}
            aria-label="Send as customer"
          >
            <Send aria-hidden />
          </Button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
      {data?.conversationId && (
        <p className="text-center text-sm">
          <Link
            href={`/inbox/${data.conversationId}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Open this chat in your inbox to reply
          </Link>
        </p>
      )}
    </div>
  );
}
