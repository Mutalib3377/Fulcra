'use client';

import { Button, Textarea } from '@fulcra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { uploadImage, type UploadedImage } from '@/components/upload-image';
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
  const [photo, setPhoto] = useState<UploadedImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
              Write a message as if you were a customer, e.g. “How much is the Ankara dress?”, or
              send a photo of something you want.
            </li>
          )}
          {messages.map((message) => (
            <ChatBubble key={message.id} message={message} mine={message.direction === 'inbound'} />
          ))}
        </ol>
        <div ref={end} />
        {photo && (
          <div className="flex items-center gap-2 border-t bg-background px-2 pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image */}
            <img
              src={photo.urls.sm}
              alt="Photo to send"
              className="size-14 rounded-md object-cover"
            />
            <span className="flex-1 text-xs text-muted-foreground">Add a message (optional)</span>
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
          className="flex items-end gap-2 border-t bg-background p-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = text.trim();
            if (!body && !photo) return;
            start(async () => {
              setError(null);
              const result = await sendTestMessageAction({
                text: body,
                image: photo?.image ?? null,
              });
              if (!result.ok) return setError(result.message);
              setText('');
              setPhoto(null);
              void queryClient.invalidateQueries({ queryKey: ['inbox'] });
            });
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
            disabled={(!text.trim() && !photo) || uploading}
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
