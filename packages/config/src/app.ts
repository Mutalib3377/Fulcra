/**
 * App-wide constants. Change the product name or domain here only.
 */
export const APP_NAME = 'Fulcra';

/** Production root domain. Placeholder until the domain is decided. */
export const DEFAULT_ROOT_DOMAIN = 'yourdomain.com';

/** Subdomain used for the owner dashboard (app.yourdomain.com). */
export const DASHBOARD_SUBDOMAIN = 'app';

/**
 * Subdomains that a business can never take as its store address.
 */
export const RESERVED_SUBDOMAINS = ['app', 'www', 'api', 'admin', 'widget'] as const;

export type ReservedSubdomain = (typeof RESERVED_SUBDOMAINS)[number];

export function isReservedSubdomain(value: string): value is ReservedSubdomain {
  return (RESERVED_SUBDOMAINS as readonly string[]).includes(value.toLowerCase());
}

/** Money is stored as integer kobo. ₦1 = 100 kobo. */
export const KOBO_PER_NAIRA = 100;

export const CURRENCY = 'NGN';
export const LOCALE = 'en-NG';

/** What a business sells. Stored as a Postgres enum (see packages/db). */
export const BUSINESS_CATEGORIES = ['fashion', 'beauty', 'food', 'gadgets', 'other'] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];
