import { isReservedSubdomain } from '@fulcra/config';

// Pure rules (no database). Safe to use in the browser via `@fulcra/core/rules`.

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 40;

export type SubdomainProblem = 'too_short' | 'too_long' | 'invalid' | 'reserved' | 'taken';

export const subdomainMessages: Record<SubdomainProblem, string> = {
  too_short: `Use at least ${SUBDOMAIN_MIN_LENGTH} characters.`,
  too_long: `Use at most ${SUBDOMAIN_MAX_LENGTH} characters.`,
  invalid: 'Use only letters, numbers and dashes, and start and end with a letter or number.',
  reserved: 'This name is reserved. Please choose another.',
  taken: 'This name is already taken. Please choose another.',
};

/** Lowercases and trims. Does not otherwise change what the user typed. */
export function normalizeSubdomain(value: string): string {
  return value.trim().toLowerCase();
}

/** Checks format and reserved words (no database access). Returns null when fine. */
export function validateSubdomain(value: string): SubdomainProblem | null {
  const subdomain = normalizeSubdomain(value);
  if (subdomain.length < SUBDOMAIN_MIN_LENGTH) return 'too_short';
  if (subdomain.length > SUBDOMAIN_MAX_LENGTH) return 'too_long';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain) || subdomain.includes('--')) {
    return 'invalid';
  }
  if (isReservedSubdomain(subdomain)) return 'reserved';
  return null;
}

/** Turns a business name into a suggested store address, e.g. "Mama Ada's Kitchen" → "mama-adas-kitchen". */
export function suggestSubdomain(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX_LENGTH)
    .replace(/-+$/g, '');
}
