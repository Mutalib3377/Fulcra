import { APP_NAME } from '@fulcra/config';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-semibold text-primary-foreground shadow-raised"
        >
          {APP_NAME.charAt(0)}
        </span>
        <p className="text-xl font-semibold tracking-[-0.02em]">{APP_NAME}</p>
      </div>
      {children}
    </main>
  );
}
