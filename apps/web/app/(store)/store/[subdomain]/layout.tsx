import type { ReactNode } from 'react';

// Store theme (from the brand kit) is applied here in S1.
export default function StoreLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
