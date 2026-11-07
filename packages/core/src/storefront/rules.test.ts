import { describe, expect, it } from 'vitest';
import { storeStockStatus, whatsAppLink, whatsAppOrderMessage } from './rules';

describe('storeStockStatus', () => {
  it('says sold out, only N left, or in stock', () => {
    expect(storeStockStatus(0, 3)).toEqual({ state: 'sold_out', label: 'Sold out' });
    expect(storeStockStatus(2, 3)).toEqual({ state: 'low', label: 'Only 2 left' });
    expect(storeStockStatus(3, 3)).toEqual({ state: 'low', label: 'Only 3 left' });
    expect(storeStockStatus(4, 3)).toEqual({ state: 'in_stock', label: 'In stock' });
    expect(storeStockStatus(1, 0)).toEqual({ state: 'in_stock', label: 'In stock' });
  });
});

describe('WhatsApp order links', () => {
  it('fills in the product, option and price', () => {
    const message = whatsAppOrderMessage({
      productName: 'Ankara Midi Dress',
      variantLabel: 'M / Red',
      price: 2_500_000,
      productUrl: 'https://ada.yourdomain.com/p/123',
    });
    expect(message).toBe(
      "Hi! I'd like to order: Ankara Midi Dress (M / Red) – ₦25,000.00\nhttps://ada.yourdomain.com/p/123",
    );
  });

  it('leaves out an empty option', () => {
    expect(
      whatsAppOrderMessage({ productName: 'Shea butter', variantLabel: '', price: 150_000 }),
    ).toBe("Hi! I'd like to order: Shea butter – ₦1,500.00");
  });

  it('uses the digits of the number and encodes the message', () => {
    expect(whatsAppLink('+2348012345678')).toBe('https://wa.me/2348012345678');
    expect(whatsAppLink('+2348012345678', 'Hi & bye\nok')).toBe(
      'https://wa.me/2348012345678?text=Hi%20%26%20bye%0Aok',
    );
  });
});

describe('textColourOn', () => {
  it('picks white on dark colours and dark text on light ones', async () => {
    const { textColourOn } = await import('./rules');
    expect(textColourOn('#0f6b55')).toBe('#ffffff');
    expect(textColourOn('#000000')).toBe('#ffffff');
    expect(textColourOn('#f5a524')).toBe('#111827');
    expect(textColourOn('#ffffff')).toBe('#111827');
  });
});

describe('whatsAppRestockMessage', () => {
  it('asks when a sold-out option is back', async () => {
    const { whatsAppRestockMessage } = await import('./rules');
    expect(whatsAppRestockMessage({ productName: 'Ankara dress', variantLabel: 'L' })).toBe(
      'Hi! Will Ankara dress (L) be available again?',
    );
  });
});
