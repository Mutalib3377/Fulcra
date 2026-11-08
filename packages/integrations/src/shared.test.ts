import { describe, expect, it } from 'vitest';
import { htmlToText, photoList, priceToKobo, splitOptions } from './shared';

describe('helpers', () => {
  it('turns HTML descriptions into plain text', () => {
    expect(
      htmlToText('<p>Soft <b>cotton</b> &amp; linen</p><ul><li>Lined</li><li>Zip</li></ul>'),
    ).toBe('Soft cotton & linen\n• Lined\n• Zip');
    expect(htmlToText(null)).toBe('');
  });

  it('puts size and colour in place and keeps other options', () => {
    expect(
      splitOptions([
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'M' },
      ]),
    ).toEqual({ size: 'M', colour: 'Red' });
    expect(
      splitOptions([
        { name: 'Size', value: 'M' },
        { name: 'Material', value: 'Cotton' },
      ]),
    ).toEqual({
      size: 'M / Cotton',
      colour: null,
    });
    expect(splitOptions([{ name: 'Weight', value: '250g' }])).toEqual({
      size: '250g',
      colour: null,
    });
  });

  it('reads prices and photo links', () => {
    expect(priceToKobo('25000.00')).toBe(2_500_000);
    expect(priceToKobo('')).toBeNull();
    expect(photoList(['https://a/1.jpg', 'https://a/1.jpg', null, 'ftp://x'])).toEqual([
      'https://a/1.jpg',
    ]);
  });
});
