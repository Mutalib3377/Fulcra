import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** "‹ Settings" link back to the parent page. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="-ml-1.5 inline-flex w-fit items-center gap-0.5 rounded-md py-1 pr-2 text-[0.9375rem] text-primary transition-opacity hover:opacity-80"
    >
      <ChevronLeft className="size-5" aria-hidden />
      {children}
    </Link>
  );
}

/** Large page title with optional back link, description and actions on the right. */
export function PageHeader({
  title,
  description,
  back,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      {eyebrow}
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-3xl font-semibold break-words">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>}
      </div>
      {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
    </div>
  );
}

/**
 * Keeps a form's main button in reach on phones: sticks above the bottom navigation while the
 * form scrolls. On larger screens it sits at the end of the form.
 */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-border/60 bg-background/85 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end md:justify-start">
        {children}
      </div>
    </div>
  );
}
