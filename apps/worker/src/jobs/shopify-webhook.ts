import { JOBS, processShopifyWebhook } from '@fulcra/core';
import type { Job } from 'pg-boss';

/** Acts on a saved Shopify app webhook (app removed: forget the shop's keys). */
export async function handleShopifyWebhook(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { webhookEventId } = JOBS.shopifyWebhook.data.parse(job.data);
    console.info(
      `[worker] shopify webhook ${webhookEventId}: ${await processShopifyWebhook(webhookEventId)}`,
    );
  }
}
