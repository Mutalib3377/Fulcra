import { describe, expect, it } from 'vitest';
import {
  amountsInData,
  amountsInText,
  describeHours,
  isOpen,
  localTime,
  unverifiedAmounts,
} from './rules';

describe('opening hours', () => {
  const hours = { mon: [['09:00', '18:00']], sat: [['10:00', '14:00']] } as const;
  it('uses Lagos time', () => {
    // 08:30 UTC is 09:30 in Lagos (UTC+1), a Monday.
    expect(localTime(new Date('2026-11-09T08:30:00Z'))).toEqual({ day: 'mon', time: '09:30' });
    expect(isOpen(hours as never, new Date('2026-11-09T08:30:00Z'))).toBe(true);
    expect(isOpen(hours as never, new Date('2026-11-09T17:30:00Z'))).toBe(false); // 18:30
    expect(isOpen(hours as never, new Date('2026-11-10T10:00:00Z'))).toBe(false); // Tuesday closed
    expect(isOpen(null, new Date())).toBe(true);
  });
  it('describes the week', () => {
    expect(describeHours(hours as never)).toBe(
      'Mon 09:00–18:00; Tue closed; Wed closed; Thu closed; Fri closed; Sat 10:00–14:00; Sun closed',
    );
    expect(describeHours(null)).toBe('Open every day, at any time');
  });
});

describe('price check', () => {
  it('finds naira amounts in the ways people write them', () => {
    expect(
      amountsInText('It is ₦25,000 or N 4,500.50, delivery 2000 naira, NGN3000, about ₦15k'),
    ).toEqual([2_500_000, 450_050, 300_000, 1_500_000, 200_000]);
    expect(amountsInText('We have size 42 and 3 pieces left')).toEqual([]);
  });

  it('allows only amounts that came from the data', () => {
    const allowed = amountsInData({
      price: 2_500_000,
      items: [{ lineTotal: 5_000_000 }],
      text: 'Delivery ₦2,000.00',
    });
    expect(unverifiedAmounts('Two dresses are ₦50,000 plus ₦2,000 delivery', allowed)).toEqual([]);
    expect(unverifiedAmounts('Special price for you: ₦22,000', allowed)).toEqual([2_200_000]);
  });
});
