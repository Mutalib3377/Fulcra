import { MAX_PRODUCT_PHOTOS, nairaToKobo, type ImportedProduct } from '@fulcra/core/rules';

/** A shop could not be read. The message is shown to the seller. */
export class ImportFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFetchError';
  }
}

/** Shop product descriptions are HTML; we keep plain text with line breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

/**
 * Our products have a size and a colour. Shop options can have any names ("Size", "Color",
 * "Material"…): size and colour go to their place; other options are added to the size
 * so no detail is lost ("M / Cotton").
 */
export function splitOptions(options: { name: string; value: string }[]): {
  size: string | null;
  colour: string | null;
} {
  let size: string | null = null;
  let colour: string | null = null;
  const rest: string[] = [];
  for (const { name, value } of options) {
    const v = value.trim();
    if (!v) continue;
    if (!colour && /colou?r/i.test(name)) colour = v;
    else if (!size && /size/i.test(name)) size = v;
    else rest.push(v);
  }
  const combined = [size, ...rest].filter(Boolean).join(' / ');
  return {
    size: combined ? combined.slice(0, 40) : null,
    colour: colour ? colour.slice(0, 40) : null,
  };
}

/** A shop price ("25000.00") in kobo, or null when missing or not a price. */
export function priceToKobo(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  return nairaToKobo(String(value));
}

export function photoList(urls: (string | null | undefined)[]): string[] {
  return [...new Set(urls.filter((u): u is string => Boolean(u && /^https?:\/\//.test(u))))].slice(
    0,
    MAX_PRODUCT_PHOTOS,
  );
}

export const UNTRACKED_STOCK_NOTE =
  "Stock isn't tracked in your shop, so it starts at 0. Update it after importing.";

/** Products read from a shop, with per-product notes for the summary. */
export type FetchedCatalog = {
  products: ImportedProduct[];
  notes: { position: number; message: string }[];
};
