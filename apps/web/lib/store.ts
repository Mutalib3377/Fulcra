import 'server-only';
import {
  getBusiness,
  getStoreBySubdomain,
  getStoreHome,
  getStoreProduct,
  listStoreProducts,
  type ActorContext,
} from '@fulcra/core';
import { unstable_cache, updateTag } from 'next/cache';
import { cache } from 'react';

/**
 * Store data is cached per business. Dashboard saves refresh it at once (`refreshStore`);
 * stock also changes from orders in the worker, which cannot reach this cache, so entries
 * also expire after a minute. Orders always re-check prices and stock in Core.
 */
const STORE_REVALIDATE_SECONDS = 60;

const businessTag = (businessId: string) => `store:${businessId}`;
const subdomainTag = (subdomain: string) => `store-address:${subdomain}`;

/** The store for an address, or null. Shared by metadata and the page in one request. */
export const loadStore = cache((subdomain: string) =>
  unstable_cache(() => getStoreBySubdomain(subdomain), ['store-info', subdomain.toLowerCase()], {
    revalidate: STORE_REVALIDATE_SECONDS,
    tags: [subdomainTag(subdomain.toLowerCase())],
  })(),
);

export const loadStoreHome = cache((businessId: string) =>
  unstable_cache(() => getStoreHome(businessId), ['store-home', businessId], {
    revalidate: STORE_REVALIDATE_SECONDS,
    tags: [businessTag(businessId)],
  })(),
);

export const loadStoreProduct = cache((businessId: string, productId: string) =>
  unstable_cache(
    () => getStoreProduct(businessId, productId),
    ['store-product', businessId, productId],
    {
      revalidate: STORE_REVALIDATE_SECONDS,
      tags: [businessTag(businessId)],
    },
  )(),
);

export const loadStoreProducts = cache(
  (businessId: string, category: string | null, page: number) =>
    unstable_cache(
      () => listStoreProducts(businessId, { category: category ?? undefined, page }),
      ['store-products', businessId, category ?? '', String(page)],
      { revalidate: STORE_REVALIDATE_SECONDS, tags: [businessTag(businessId)] },
    )(),
);

/**
 * Call from a Server Action after changing anything the store shows (products, stock,
 * brand kit, business details), so customers see it straight away.
 */
export async function refreshStore(actor: ActorContext): Promise<void> {
  updateTag(businessTag(actor.businessId));
  try {
    const business = await getBusiness(actor);
    updateTag(subdomainTag(business.subdomain));
  } catch {
    // The store refreshes by itself within a minute.
  }
}
