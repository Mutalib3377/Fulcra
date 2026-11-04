import { CURRENCY, KOBO_PER_NAIRA, LOCALE } from './app';

const formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });

/** Formats an integer amount in kobo for display, e.g. 150000 → "₦1,500.00". */
export function formatNaira(kobo: number): string {
  if (!Number.isInteger(kobo)) {
    throw new Error(`Amount must be an integer number of kobo, got ${kobo}`);
  }
  return formatter.format(kobo / KOBO_PER_NAIRA);
}
