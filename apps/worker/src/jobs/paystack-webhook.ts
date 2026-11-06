import { JOBS, processPaystackWebhook } from '@fulcra/core';
import type { Job } from 'pg-boss';

/** Confirms a Paystack payment from a saved webhook. Throwing makes pg-boss retry later. */
export async function handlePaystackWebhook(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { webhookEventId } = JOBS.paystackWebhook.data.parse(job.data);
    const result = await processPaystackWebhook(webhookEventId);
    console.info(`[worker] paystack webhook ${webhookEventId}: ${result}`);
  }
}
