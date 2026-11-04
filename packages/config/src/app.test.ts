import { describe, expect, it } from 'vitest';
import { isReservedSubdomain } from './app';

describe('isReservedSubdomain', () => {
  it('blocks reserved words regardless of case', () => {
    expect(isReservedSubdomain('app')).toBe(true);
    expect(isReservedSubdomain('WWW')).toBe(true);
    expect(isReservedSubdomain('mystore')).toBe(false);
  });
});
