import { APP_NAME } from '@fulcra/config';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <p className="text-center text-lg font-bold text-primary">{APP_NAME}</p>
      {children}
    </main>
  );
}
