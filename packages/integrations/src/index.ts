/**
 * @fulcra/integrations — catalog sources. Reads products from other shops and turns them
 * into Core's ImportedProduct; Core saves them (docs/decisions/0008).
 */
import type { FetchTarget } from '@fulcra/core';
import type { FetchedCatalog } from './shared';
import { fetchShopifyCatalog } from './shopify/products';
import { fetchWooCatalog } from './woocommerce/products';

export { ImportFetchError, type FetchedCatalog } from './shared';
export * from './shopify/oauth';
export { fetchShopifyCatalog, mapShopifyProduct, shopifyApiVersion } from './shopify/products';
export { fetchWooCatalog, mapWooProduct, verifyWooConnection } from './woocommerce/products';

/** Reads all products from a connected shop. Throws ImportFetchError with a plain message. */
export function fetchShopCatalog(
  target: FetchTarget,
  env?: NodeJS.ProcessEnv,
): Promise<FetchedCatalog> {
  return target.kind === 'shopify'
    ? fetchShopifyCatalog(target.shopUrl, target.credentials, env)
    : fetchWooCatalog({ shopUrl: target.shopUrl, credentials: target.credentials }, env);
}
