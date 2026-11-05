import { describe, expect, it } from 'vitest';
import {
  isLowStock,
  koboToNairaInput,
  nairaToKobo,
  variantCombinations,
  variantLabel,
} from './rules';

describe('nairaToKobo', () => {
  it.each([
    ['15000', 1_500_000],
    ['15,000', 1_500_000],
    ['₦2,500.50', 250_050],
    ['0.5', 50],
    ['0', 0],
    [1500, 150_000],
  ])('%s → %d kobo', (input, kobo) => {
    expect(nairaToKobo(input)).toBe(kobo);
  });

  it.each(['', 'abc', '-5', '1.234', '1e5', '12.'])('rejects %j', (input) => {
    expect(nairaToKobo(input)).toBeNull();
  });
});

describe('koboToNairaInput', () => {
  it('round-trips with nairaToKobo', () => {
    for (const kobo of [0, 50, 150_000, 250_050]) {
      expect(nairaToKobo(koboToNairaInput(kobo))).toBe(kobo);
    }
    expect(koboToNairaInput(null)).toBe('');
  });
});

describe('variantCombinations', () => {
  it('builds every size × colour, ignoring blanks and duplicates', () => {
    expect(variantCombinations(['S', 'M', ' m ', ''], ['Red', 'Black'])).toEqual([
      { size: 'S', colour: 'Red' },
      { size: 'S', colour: 'Black' },
      { size: 'm', colour: 'Red' },
      { size: 'm', colour: 'Black' },
    ]);
    expect(variantCombinations(['S'], [])).toEqual([{ size: 'S', colour: null }]);
    expect(variantCombinations([], ['Red'])).toEqual([{ size: null, colour: 'Red' }]);
    expect(variantCombinations([], [])).toEqual([]);
  });
});

describe('labels and stock', () => {
  it('labels variants and detects low stock', () => {
    expect(variantLabel({ size: 'M', colour: 'Red' })).toBe('M / Red');
    expect(variantLabel({ size: null, colour: null })).toBe('Default');
    expect(isLowStock(3, 3)).toBe(true);
    expect(isLowStock(4, 3)).toBe(false);
  });
});
