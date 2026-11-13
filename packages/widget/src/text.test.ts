import { describe, expect, it } from 'vitest';
import { linkify, randomId, textOn } from './text';

describe('widget helpers', () => {
  it('makes links clickable without the sentence punctuation', () => {
    expect(linkify('Pay here: https://paystack.com/pay/abc. Thanks!')).toEqual([
      { text: 'Pay here: ' },
      { text: 'https://paystack.com/pay/abc', href: 'https://paystack.com/pay/abc' },
      { text: '. Thanks!' },
    ]);
    expect(linkify('no links')).toEqual([{ text: 'no links' }]);
    expect(linkify('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });

  it('random ids and readable text colour', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(randomId()).not.toBe(randomId());
    expect(textOn('#0f6b55')).toBe('#ffffff');
    expect(textOn('#f5e6a0')).toBe('#111111');
    expect(textOn('bad')).toBe('#ffffff');
  });
});
