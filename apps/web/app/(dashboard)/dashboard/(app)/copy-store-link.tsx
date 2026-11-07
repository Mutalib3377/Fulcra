'use client';

import { Button } from '@fulcra/ui';
import { Check, Copy, MessageCircle } from 'lucide-react';
import { useState } from 'react';

/** Copy or share the store link (WhatsApp share works on every phone). */
export function CopyStoreLink({ url, businessName }: { url: string; businessName: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  const share = `https://wa.me/?text=${encodeURIComponent(`Shop ${businessName} here: ${url}`)}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={share} target="_blank" rel="noreferrer">
          <MessageCircle aria-hidden /> Share on WhatsApp
        </a>
      </Button>
    </div>
  );
}
