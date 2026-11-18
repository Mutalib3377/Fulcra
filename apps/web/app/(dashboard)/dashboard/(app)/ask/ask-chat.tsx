'use client';

import { Button, cn, Textarea } from '@fulcra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { uploadImage, type UploadedImage } from '@/components/upload-image';
import { fetchJson } from '../inbox/types';
import { sendOwnerMessageAction } from './actions';

type ChatData = {
  messages: {
    id: string;
    sender: 'owner' | 'assistant';
    text: string;
    imageUrl: string | null;
    createdAt: string;
  }[];
  pending: { summary: string; expiresAt: string } | null;
  limit: { used: number; limit: number };
  thinking: boolean;
};

const SUGGESTIONS = [
  'How much did I sell today?',
  "Who hasn't paid?",
  "What's running low?",
  'What was my best seller this month?',
];

/** The owner's chat with their assistant. Checks often while it is thinking, rarely otherwise. */
export function AskChat() {
  const queryClient = useQueryClient();
  const { data, error: loadError } = useQuery({
    queryKey: ['owner-chat'],
    queryFn: () => fetchJson<ChatData>('/api/owner-chat'),
    refetchInterval: (query) => (query.state.data?.thinking ? 1_500 : 10_000),
  });
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const messages = data?.messages ?? [];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, data?.thinking]);

  const send = (body: string, image: UploadedImage | null = photo) => {
    if (!body.trim() && !image) return;
    start(async () => {
      setError(null);
      const result = await sendOwnerMessageAction({
        text: body.trim(),
        image: image?.image ?? null,
      });
      if (!result.ok) return setError(result.message);
      setText('');
      setPhoto(null);
      await queryClient.invalidateQueries({ queryKey: ['owner-chat'] });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-[55dvh] flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
        <ol
          className="flex flex-1 flex-col gap-3 p-4"
          aria-label="Your chat with Fulcra"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <li className="m-auto flex max-w-sm flex-col items-center gap-4 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                <Sparkles className="size-6" aria-hidden />
              </span>
              <p className="text-muted-foreground">
                Ask me anything about your shop, or send a photo to add a new product. You can write
                in English or Pidgin.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s, null)}
                    className="rounded-full border border-input bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </li>
          )}
          {messages.map((m) => {
            const mine = m.sender === 'owner';
            return (
              <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'flex max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-2.5 text-[0.9375rem] whitespace-pre-wrap',
                    mine
                      ? 'rounded-br-md bg-primary text-primary-foreground'
                      : 'rounded-bl-md bg-muted text-foreground',
                  )}
                >
                  {m.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                    <img
                      src={m.imageUrl}
                      alt="Photo you sent"
                      className="max-h-48 rounded-lg object-cover"
                    />
                  )}
                  {m.text}
                </div>
              </li>
            );
          })}
          {data?.thinking && (
            <li className="flex justify-start" aria-label="Fulcra is typing">
              <span className="flex gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-2 animate-pulse rounded-full bg-muted-foreground/60"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </li>
          )}
          <div ref={end} />
        </ol>

        {data?.pending && (
          <div className="flex flex-col gap-2 border-t border-border/70 bg-primary-soft/60 px-4 py-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm">
              <span className="font-medium">Waiting for your yes:</span> {data.pending.summary}
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => send('yes', null)} loading={sending}>
                <Check aria-hidden /> Yes
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => send('no', null)}
                disabled={sending}
              >
                No
              </Button>
            </div>
          </div>
        )}

        {photo && (
          <div className="flex items-center gap-2 border-t border-border/70 px-3 pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
            <img
              src={photo.urls.sm}
              alt="Photo to send"
              className="size-14 rounded-md object-cover"
            />
            <span className="flex-1 text-xs text-muted-foreground">
              Say what it is, e.g. “Adire top, 12k, 4 pieces”
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove photo"
              onClick={() => setPhoto(null)}
            >
              <X aria-hidden />
            </Button>
          </div>
        )}
        <form
          className="flex items-end gap-2 border-t border-border/70 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Choose a photo"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setError(null);
              setUploading(true);
              try {
                setPhoto(await uploadImage(file));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
              } finally {
                setUploading(false);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            loading={uploading}
            aria-label="Send a photo"
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus aria-hidden />
          </Button>
          <Textarea
            aria-label="Message to Fulcra"
            placeholder="Ask or tell Fulcra…"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            className="min-h-11 flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            loading={sending}
            disabled={(!text.trim() && !photo) || uploading}
            aria-label="Send"
          >
            <Send aria-hidden />
          </Button>
        </form>
      </div>
      {(error || loadError) && (
        <p role="alert" className="text-center text-sm text-danger">
          {error ?? loadError?.message}
        </p>
      )}
      {data && (
        <p className="text-center text-xs text-muted-foreground">
          {data.limit.used} of {data.limit.limit} messages this month
        </p>
      )}
    </div>
  );
}
