/**
 * @fulcra/core — all business logic lives here.
 * Pages, routes, webhooks, integrations and agent tools call these services.
 */
export * from './shared/errors';
export { normalizePhoneNumber } from './shared/phone';

export * from './businesses/subdomain';
export * from './businesses/create-business';
export * from './businesses/get-business';

export { requireMember, type ActorContext, type MemberRole } from './members/access';
export * from './members/memberships';
export * from './members/invites';

export * from './entitlements/can-use';

export { BUSINESS_CATEGORIES, type BusinessCategory } from '@fulcra/config';

export * from './brand-kit/brand-kit';
export * from './catalog/rules';
export * from './catalog/products';
export * from './catalog/stock';
export {
  IMAGE_SIZES,
  MAX_IMAGE_BYTES,
  imageUrl,
  type ImageSize,
  type StoredImage,
} from './media/images';
export { uploadImage } from './media/upload';
