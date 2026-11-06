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

export * from './events/events';
export * from './delivery/zones';
export * from './customers/customers';
export * from './orders/rules';
export * from './orders/orders';

export * from './payments/paystack';
export * from './payments/payout';
export * from './payments/payments';
export * from './payments/receipts';
export * from './payments/dedicated-accounts';
export * from './payments/transfers';
export { receiptUrl } from './payments/urls';
export * from './jobs/queue';
