// "Chat on WhatsApp" buttons for sellers' own websites (I2). Pure functions, browser-safe
// via `@fulcra/core/rules`. The code is plain HTML with inline styles: nothing to load,
// so it cannot slow down or break the seller's site.

import { whatsAppOrderMessage } from './rules';

const DEFAULT_COLOUR = '#1f8f4e';

/** Escapes text for use inside HTML text or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const safeColour = (colour: string | null | undefined) =>
  colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : DEFAULT_COLOUR;

/** A small speech-bubble icon (inline SVG, white). */
const ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';

export type WhatsAppButtonOptions = {
  /** wa.me link, from `whatsAppLink`. */
  href: string;
  /** Button text, e.g. "Chat with us on WhatsApp". */
  label: string;
  /** Brand colour (#rrggbb); WhatsApp green when missing. */
  colour?: string | null;
};

/** A button to paste anywhere on a page (e.g. under a product). */
export function whatsAppButtonHtml({ href, label, colour }: WhatsAppButtonOptions): string {
  const bg = safeColour(colour);
  return (
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" ` +
    `style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:8px;` +
    `background:${bg};color:#fff;font:600 16px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none">` +
    `${ICON}${escapeHtml(label)}</a>`
  );
}

/** A round chat bubble fixed to the bottom-right corner of every page. */
export function whatsAppFloatingHtml({ href, label, colour }: WhatsAppButtonOptions): string {
  const bg = safeColour(colour);
  return (
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" ` +
    `style="position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;justify-content:center;` +
    `width:56px;height:56px;border-radius:50%;background:${bg};color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.25);text-decoration:none">` +
    `${ICON.replace('width="20" height="20"', 'width="28" height="28"')}</a>`
  );
}

/**
 * The message a product's button sends. Products with sizes or colours leave the price out
 * (it depends on the option); the customer says which one they want in the chat.
 */
export function whatsAppProductMessage(product: {
  productName: string;
  price: number;
  hasOptions: boolean;
}): string {
  return product.hasOptions
    ? `Hi! I'd like to order: ${product.productName}`
    : whatsAppOrderMessage({ productName: product.productName, price: product.price });
}
