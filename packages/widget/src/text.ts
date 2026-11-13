/** Pure helpers for the widget (tested; no DOM). */

/** Splits a message into plain text and links, so links can be made clickable safely. */
export function linkify(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    let url = match[0];
    // Trailing punctuation belongs to the sentence, not the link.
    const trail = /[.,!?;:)]+$/.exec(url)?.[0] ?? '';
    url = url.slice(0, url.length - trail.length);
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** A random id (visitor or message), from the browser's secure random source. */
export function randomId(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** "14:05" in the visitor's own time. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Black or white text, whichever reads better on the brand colour. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111111' : '#ffffff';
}
