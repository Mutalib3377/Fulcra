import type { BillingSummary } from '@fulcra/core';

const date = (d: Date) =>
  d.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long' });

/** The one billing message that matters most right now, or null. */
export function bannerFor(
  b: BillingSummary,
  now = new Date(),
): { tone: 'danger' | 'warning' | 'info'; text: string } | null {
  if (b.status === 'expired')
    return {
      tone: 'danger',
      text: 'Your Fulcra plan has ended. Your store, orders and payments still work, but the assistant and alerts are paused.',
    };
  if (b.status === 'past_due')
    return {
      tone: 'warning',
      text: 'We couldn’t take your Fulcra payment. Update your payment soon to keep your assistant on.',
    };
  const { used, limit } = b.usage;
  if (limit > 0 && used >= limit)
    return {
      tone: 'warning',
      text: `Your assistant has answered all ${limit} chats included this month. New chats now come to you.`,
    };
  if (b.status === 'trialing' && b.trialEndsAt) {
    const days = Math.ceil((b.trialEndsAt.getTime() - now.getTime()) / 86_400_000);
    if (days <= 3)
      return {
        tone: 'info',
        text: `Your free trial ends ${days <= 1 ? 'tomorrow' : `in ${days} days`} (${date(b.trialEndsAt)}). Choose a plan to keep your assistant on.`,
      };
  }
  if (limit > 0 && used >= Math.ceil(limit * 0.8))
    return {
      tone: 'info',
      text: `Your assistant has answered ${used} of ${limit} chats included this month.`,
    };
  return null;
}
