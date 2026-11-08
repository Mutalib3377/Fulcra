import {
  claimImportFetch,
  failImportFetch,
  JOBS,
  processCatalogImport,
  saveFetchedProducts,
} from '@fulcra/core';
import { fetchShopCatalog, ImportFetchError } from '@fulcra/integrations';
import type { Job } from 'pg-boss';

/**
 * Runs a catalog import. Shop imports (Shopify, WooCommerce) first read the shop's
 * products; then the approved products are saved one by one. Throwing makes pg-boss
 * retry later; a retry continues where the last run stopped.
 */
export async function handleCatalogImport(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, importId } = JOBS.catalogImport.data.parse(job.data);
    const target = await claimImportFetch(businessId, importId);
    if (target) {
      try {
        const catalog = await fetchShopCatalog(target);
        await saveFetchedProducts(businessId, importId, catalog.products, catalog.notes);
        console.info(
          `[worker] import ${importId}: read ${catalog.products.length} products from ${target.kind}`,
        );
      } catch (error) {
        if (!(error instanceof ImportFetchError)) throw error; // unexpected: retry later
        await failImportFetch(businessId, importId, error.message);
        console.info(`[worker] import ${importId}: shop could not be read (${error.message})`);
        continue;
      }
    }
    const result = await processCatalogImport(businessId, importId);
    console.info(`[worker] catalog import ${importId}: ${result}`);
  }
}
