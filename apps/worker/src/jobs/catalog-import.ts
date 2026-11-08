import { JOBS, processCatalogImport } from '@fulcra/core';
import type { Job } from 'pg-boss';

/** Saves the approved products of a catalog import. Throwing makes pg-boss retry later. */
export async function handleCatalogImport(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, importId } = JOBS.catalogImport.data.parse(job.data);
    const result = await processCatalogImport(businessId, importId);
    console.info(`[worker] catalog import ${importId}: ${result}`);
  }
}
