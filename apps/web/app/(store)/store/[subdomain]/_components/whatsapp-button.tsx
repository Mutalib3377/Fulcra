import { cn } from '@fulcra/ui';
import { MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';

/** A big "Order on WhatsApp" link. Plain link: works with no JavaScript. */
export function WhatsAppButton({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#1f8f4e] px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-[#187a42] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f8f4e]',
        className,
      )}
    >
      <MessageCircle className="size-5" aria-hidden />
      {children}
    </a>
  );
}
