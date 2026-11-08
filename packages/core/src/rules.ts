/**
 * Browser-safe Core rules: pure functions with no database access.
 * Client Components import from `@fulcra/core/rules`, never from `@fulcra/core`.
 */
export * from './businesses/subdomain-rules';
export { normalizePhoneNumber } from './shared/phone';
export { BUSINESS_CATEGORIES, type BusinessCategory } from '@fulcra/config';
export * from './catalog/rules';
export { MAX_IMAGE_BYTES_CLIENT } from './media/limits';
export type { StoredImage } from '@fulcra/db/schema';
export type { ProductInput } from './catalog/products';
export type { BrandFont, BrandVoice } from '@fulcra/db/schema';
export const BRAND_FONTS = ['clean', 'modern', 'friendly', 'elegant', 'bold'] as const;
export const BRAND_VOICES = ['friendly', 'professional', 'playful'] as const;
export * from './orders/rules';
export type { OrderStatus, FulfilmentMethod, OrderChannel } from '@fulcra/db/schema';
export * from './storefront/rules';
export type {
  CatalogImportKind,
  CatalogImportStatus,
  ImportedProduct,
  ImportedVariant,
  ImportProblem,
  CatalogSourceKind,
  CatalogSourceStatus,
} from '@fulcra/db/schema';
export * from './storefront/whatsapp-buttons';
