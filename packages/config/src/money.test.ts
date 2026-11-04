import { describe, expect, it } from 'vitest';
import { formatNaira } from './money';

describe('formatNaira', () => {
  it('formats kobo as naira', () => {
    expect(formatNaira(150000)).toBe('₦1,500.00');
    expect(formatNaira(0)).toBe('₦0.00');
  });

  it('rejects fractional kobo', () => {
    expect(() => formatNaira(10.5)).toThrow();
  });
});
