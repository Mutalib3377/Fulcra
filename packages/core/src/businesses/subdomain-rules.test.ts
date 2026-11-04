import { describe, expect, it } from 'vitest';
import { suggestSubdomain, validateSubdomain } from './subdomain-rules';

describe('validateSubdomain', () => {
  it('accepts simple names', () => {
    expect(validateSubdomain('mama-ada')).toBeNull();
    expect(validateSubdomain('  Shop123 ')).toBeNull();
  });

  it.each([
    ['ab', 'too_short'],
    ['a'.repeat(41), 'too_long'],
    ['-shop', 'invalid'],
    ['shop-', 'invalid'],
    ['my shop', 'invalid'],
    ['my--shop', 'invalid'],
    ['shop.ng', 'invalid'],
    ['app', 'reserved'],
    ['WWW', 'reserved'],
    ['admin', 'reserved'],
  ])('rejects %j as %s', (value, problem) => {
    expect(validateSubdomain(value)).toBe(problem);
  });
});

describe('suggestSubdomain', () => {
  it('builds a store address from a business name', () => {
    expect(suggestSubdomain("Mama Ada's Kitchen")).toBe('mama-adas-kitchen');
    expect(suggestSubdomain('  Glow & Co. ')).toBe('glow-and-co');
    expect(suggestSubdomain('Café Ọ̀lá')).toBe('cafe-ola');
  });
});
