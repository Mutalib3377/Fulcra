import { getBillingSummary } from '@fulcra/core';
import { bannerFor } from '@/lib/billing';
import Link from 'next/link';
import type { ActorContext } from '@fulcra/core';

const TONES = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-muted text-foreground',
} as const;

/** Shown at the top of every dashboard page when billing needs attention. */
export async function BillingBanner({ actor }: { actor: ActorContext }) {
  let banner: ReturnType<typeof bannerFor> = null;
  try {
    banner = bannerFor(await getBillingSummary(actor));
  } catch {
    return null; // never break the dashboard over a banner
  }
  if (!banner) return null;
  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-sm ${TONES[banner.tone]}`}
    >
      <span className="flex-1">{banner.text}</span>
      <Link href="/settings/billing" className="font-semibold underline-offset-4 hover:underline">
        Plans and billing
      </Link>
    </div>
  );
}
