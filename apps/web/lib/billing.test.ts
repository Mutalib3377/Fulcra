import { describe, expect, it } from 'vitest';
import { bannerFor } from './billing';

const base = {
  planCode: 'growth' as const,
  planName: 'Growth',
  status: 'active' as const,
  active: true,
  suspended: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  pendingPlanCode: null,
  usage: { used: 10, limit: 500, month: '2026-11' },
  invoices: [],
};
const now = new Date('2026-11-16T12:00:00Z');

describe('billing banner', () => {
  it('shows the most important message only', () => {
    expect(bannerFor(base, now)).toBeNull();
    expect(bannerFor({ ...base, usage: { ...base.usage, used: 400 } }, now)?.text).toContain(
      '400 of 500',
    );
    expect(bannerFor({ ...base, usage: { ...base.usage, used: 500 } }, now)?.text).toContain(
      'New chats now come to you',
    );
    expect(
      bannerFor(
        { ...base, status: 'trialing', trialEndsAt: new Date(now.getTime() + 2 * 86_400_000) },
        now,
      )?.text,
    ).toContain('in 2 days');
    expect(
      bannerFor(
        { ...base, status: 'trialing', trialEndsAt: new Date(now.getTime() + 9 * 86_400_000) },
        now,
      ),
    ).toBeNull();
    expect(bannerFor({ ...base, status: 'expired', active: false }, now)).toMatchObject({
      tone: 'danger',
    });
    expect(bannerFor({ ...base, status: 'past_due' }, now)?.tone).toBe('warning');
  });
});
