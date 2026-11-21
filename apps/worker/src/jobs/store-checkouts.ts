import { businessesWithStaleStoreCheckouts, expireStoreCheckouts } from '@fulcra/core';

/**
 * Every 5 minutes: store orders not paid within 30 minutes of checkout are cancelled, so the
 * stock they held goes back on sale (K1, docs/decisions/0025).
 */
export async function handleStoreCheckoutExpiry(now = new Date()): Promise<void> {
  for (const businessId of await businessesWithStaleStoreCheckouts(now)) {
    try {
      const cancelled = await expireStoreCheckouts(businessId, now);
      if (cancelled) console.info(`[worker] ${cancelled} unpaid store checkout(s) cancelled`);
    } catch (error) {
      // One business's problem must not stop the others; the next run tries again.
      console.error('[worker] store checkout expiry failed for a business', error);
    }
  }
}
