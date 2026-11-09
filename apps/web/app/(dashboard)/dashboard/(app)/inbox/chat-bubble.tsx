import { cn } from '@fulcra/ui';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import type { ChatMessage } from './types';

const SENDER_LABEL = { agent: 'Assistant', human: 'Team', system: 'Fulcra', customer: '' } as const;

function time(iso: string) {
  return new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
}

function Status({ message }: { message: ChatMessage }) {
  switch (message.status) {
    case 'queued':
      return <Clock className="size-3.5" aria-label="Sending" />;
    case 'sent':
      return <Check className="size-3.5" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="size-3.5" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck className="size-3.5 text-info" aria-label="Read" />;
    case 'failed':
      return <AlertCircle className="size-3.5 text-danger" aria-label="Not sent" />;
    default:
      return null;
  }
}

const MEDIA_LABEL: Record<string, string> = {
  image: '📷 Photo',
  audio: '🎤 Voice note',
  video: '🎬 Video',
  document: '📄 File',
  location: '📍 Location',
  unsupported: 'A message type we can’t show yet',
};

/**
 * One message. `mine` is the side of the person looking: the team in the inbox, the
 * customer in the test chat.
 */
export function ChatBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const label = message.direction === 'outbound' ? SENDER_LABEL[message.sender] : '';
  return (
    <li className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex max-w-[85%] flex-col gap-1 rounded-2xl px-3 py-2 text-sm shadow-xs',
          mine ? 'rounded-br-sm bg-success-soft' : 'rounded-bl-sm bg-card',
        )}
      >
        {label && <span className="text-xs font-semibold text-primary">{label}</span>}
        {message.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
          <img
            src={message.imageUrl}
            alt="Photo from the chat"
            className="max-h-64 rounded-lg object-cover"
            loading="lazy"
          />
        ) : !message.text && MEDIA_LABEL[message.type] ? (
          <span className="text-muted-foreground italic">{MEDIA_LABEL[message.type]}</span>
        ) : null}
        {message.text && <p className="break-words whitespace-pre-wrap">{message.text}</p>}
        <span className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {time(message.createdAt)}
          {message.direction === 'outbound' && <Status message={message} />}
        </span>
        {message.status === 'failed' && (
          <span className="text-xs text-danger">{message.error ?? 'Not sent.'}</span>
        )}
      </div>
    </li>
  );
}
