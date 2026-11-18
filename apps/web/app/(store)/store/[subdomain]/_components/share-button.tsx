'use client';

import { cn } from '@fulcra/ui';
import { Share2 } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

/**
 * "Share": the phone's share sheet when it has one, otherwise WhatsApp. Without JavaScript
 * it is a plain link that opens WhatsApp with the store's link filled in.
 */
export function ShareButton({
  url,
  title,
  text,
  label = 'Share',
  className,
  iconOnly = false,
}: {
  url: string;
  title: string;
  text: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;

  const onClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (typeof navigator === 'undefined') return;
    if (navigator.share) {
      event.preventDefault();
      try {
        await navigator.share({ title, text, url });
      } catch {
        // Closed the share sheet: nothing to do.
      }
      return;
    }
    if (navigator.clipboard && window.matchMedia('(pointer: fine)').matches) {
      // Computers usually have no WhatsApp app: copy the link instead.
      event.preventDefault();
      await navigator.clipboard.writeText(url).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <a
      href={whatsapp}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={iconOnly ? label : undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        className,
      )}
    >
      <Share2 className="size-[1.1em]" aria-hidden />
      {iconOnly ? null : <span aria-live="polite">{copied ? 'Link copied' : label}</span>}
    </a>
  );
}
