// Pure catalog rules (no database). Browser-safe via `@fulcra/core/rules`.

export const MAX_PRODUCT_PHOTOS = 8;
export const MAX_VARIANTS = 100;
export const DEFAULT_LOW_STOCK_THRESHOLD = 3;

/**
 * Parses a naira amount typed by a user ("15,000", "₦2,500.50", "1500") into kobo.
 * Returns null for anything that is not a valid non-negative amount with at most 2 decimals.
 */
export function nairaToKobo(input: string | number): number | null {
  const text = String(input).trim().replace(/^₦\s*/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/** Kobo to a plain naira string for form fields: 150000 → "1500", 150050 → "1500.50". */
export function koboToNairaInput(kobo: number | null | undefined): string {
  if (kobo === null || kobo === undefined) return '';
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return rest === 0 ? String(naira) : `${naira}.${String(rest).padStart(2, '0')}`;
}

export function isLowStock(stock: number, threshold: number): boolean {
  return stock <= threshold;
}

/** Every size × colour combination, in the order given. Empty lists are ignored. */
export function variantCombinations(
  sizes: string[],
  colours: string[],
): { size: string | null; colour: string | null }[] {
  const clean = (list: string[]) => [
    ...new Map(
      list
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => [v.toLowerCase(), v]),
    ).values(),
  ];
  const s = clean(sizes);
  const c = clean(colours);
  if (s.length === 0 && c.length === 0) return [];
  if (c.length === 0) return s.map((size) => ({ size, colour: null }));
  if (s.length === 0) return c.map((colour) => ({ size: null, colour }));
  return s.flatMap((size) => c.map((colour) => ({ size, colour })));
}

/** "M / Red", "M", "Red", or "Default". */
export function variantLabel(v: { size: string | null; colour: string | null }): string {
  return [v.size, v.colour].filter(Boolean).join(' / ') || 'Default';
}
