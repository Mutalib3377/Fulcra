'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-checks the page every few seconds (for "confirming your payment"). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
