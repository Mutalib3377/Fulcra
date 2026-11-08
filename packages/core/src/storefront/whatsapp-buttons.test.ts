import { describe, expect, it } from 'vitest';
import { whatsAppLink, whatsAppOrderMessage } from './rules';
import { escapeHtml, whatsAppButtonHtml, whatsAppFloatingHtml } from './whatsapp-buttons';

describe('WhatsApp buttons', () => {
  const href = whatsAppLink(
    '+2348031234567',
    whatsAppOrderMessage({ productName: 'Ada\'s "Best" <Wrap> & Tie', price: 350_000 }),
  );

  it('escapes names and links so pasted code cannot break the page', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
    const html = whatsAppButtonHtml({ href, label: 'Order <now>', colour: '#7C2D12' });
    expect(html).toContain('href="https://wa.me/2348031234567?text=');
    expect(html).toContain('background:#7c2d12');
    expect(html).toContain('Order &lt;now&gt;</a>');
    expect(html).not.toContain('<now>');
    expect(html).not.toMatch(/<script/i);
  });

  it('falls back to WhatsApp green for a missing or odd colour', () => {
    expect(whatsAppButtonHtml({ href, label: 'Chat', colour: 'red;position:fixed' })).toContain(
      'background:#1f8f4e',
    );
    expect(whatsAppFloatingHtml({ href, label: 'Chat', colour: null })).toContain(
      'background:#1f8f4e',
    );
  });

  it('makes a fixed corner bubble with an accessible name', () => {
    const html = whatsAppFloatingHtml({ href, label: 'Chat with Ada Styles', colour: '#0f6b55' });
    expect(html).toContain('position:fixed;right:16px;bottom:16px');
    expect(html).toContain('aria-label="Chat with Ada Styles"');
  });

  it('carries the order message in the link', () => {
    const text = decodeURIComponent(new URL(href).searchParams.get('text')!);
    expect(text).toBe('Hi! I\'d like to order: Ada\'s "Best" <Wrap> & Tie – ₦3,500.00');
  });
});

describe('whatsAppProductMessage', () => {
  it('leaves the price out when it depends on size or colour', async () => {
    const { whatsAppProductMessage } = await import('./whatsapp-buttons');
    expect(whatsAppProductMessage({ productName: 'Cap', price: 200_000, hasOptions: false })).toBe(
      "Hi! I'd like to order: Cap – ₦2,000.00",
    );
    expect(
      whatsAppProductMessage({ productName: 'Dress', price: 2_500_000, hasOptions: true }),
    ).toBe("Hi! I'd like to order: Dress");
  });
});
