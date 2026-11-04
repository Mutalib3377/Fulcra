/**
 * Browser-safe Core rules: pure functions with no database access.
 * Client Components import from `@fulcra/core/rules`, never from `@fulcra/core`.
 */
export * from './businesses/subdomain-rules';
export { normalizePhoneNumber } from './shared/phone';
export { BUSINESS_CATEGORIES, type BusinessCategory } from '@fulcra/config';
