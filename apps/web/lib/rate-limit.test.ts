import { describe, expect, it } from 'vitest';
import { allow } from './rate-limit';

describe('rate limit', () => {
  it('allows up to the limit in the window, then again after it', () => {
    const key = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => allow(key, 3, 1000, 0))).toEqual([true, true, true]);
    expect(allow(key, 3, 1000, 500)).toBe(false);
    expect(allow(key, 3, 1000, 1001)).toBe(true);
  });
});
