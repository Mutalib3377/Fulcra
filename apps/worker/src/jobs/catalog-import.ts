import {
  claimImportFetch,
  failImportFetch,
  JOBS,
  processCatalogImport,
  recordAiUsage,
  saveFetchedProducts,
} from '@fulcra/core';
import {
  extractWebsiteCatalog,
  fetchShopCatalog,
  ImportFetchError,
  websiteReaderFromEnv,
} from '@fulcra/integrations';
import type { Job } from 'pg-boss';

/**
 * Runs a catalog import. Shop imports (Shopify, WooCommerce) first read the shop and save
 * straight away. Website imports read the site (with AI where needed) and then wait for the
 * seller's review. Throwing makes pg-boss retry later; a retry continues where it stopped.
 */
export async function handleCatalogImport(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, importId } = JOBS.catalogImport.data.parse(job.data);
    const target = await claimImportFetch(businessId, importId);
    if (target) {
      try {
        if (target.kind === 'url') {
          const catalog = await extractWebsiteCatalog(target.url, {
            anthropic: websiteReaderFromEnv(),
            // Rule 12: every AI call is logged against the business with its cost.
            onUsage: async (usage) => {
              await recordAiUsage(businessId, { feature: 'catalog_import.url', ...usage });
            },
          });
          await saveFetchedProducts(businessId, importId, catalog.products, catalog.notes, {
            review: true,
            sourceRefs: catalog.sourceRefs,
          });
          console.info(
            `[worker] import ${importId}: found ${catalog.products.length} products on the website`,
          );
          continue; // waits for the seller's review
        }
        const catalog = await fetchShopCatalog(target);
        await saveFetchedProducts(businessId, importId, catalog.products, catalog.notes);
        console.info(
          `[worker] import ${importId}: read ${catalog.products.length} products from ${target.kind}`,
        );
      } catch (error) {
        if (!(error instanceof ImportFetchError)) throw error; // unexpected: retry later
        await failImportFetch(businessId, importId, error.message);
        console.info(`[worker] import ${importId}: could not read (${error.message})`);
        continue;
      }
    }
    const result = await processCatalogImport(businessId, importId);
    console.info(`[worker] catalog import ${importId}: ${result}`);
  }
}
