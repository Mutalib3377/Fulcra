import { APP_NAME } from '@fulcra/config';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Layout for the privacy policy and terms: readable width, clear headings, a draft notice. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
          <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden />
          {APP_NAME}
        </Link>
      </header>
      <article className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-8 pb-24">
        <div
          role="note"
          className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          Draft for review. This text has not yet been checked by a lawyer and may change before
          launch.
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold md:text-5xl">{title}</h1>
          <p className="text-muted-foreground">Last updated {updated}</p>
        </div>
        <div className="flex flex-col gap-4 text-[1.0625rem] leading-7 text-foreground/90 [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-2">
          {children}
        </div>
      </article>
    </main>
  );
}
