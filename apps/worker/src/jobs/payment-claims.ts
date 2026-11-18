import { businessesWithOpenClaims, sweepPaymentClaims } from '@fulcra/core';

/**
 * Every minute: payment claims (a customer's "I've paid" or transfer screenshot) are checked
 * against the money that arrived. Nothing after 20 minutes → the owner alert job warns the
 * owner (F1, docs/decisions/0024).
 */
export async function handlePaymentClaims(now = new Date()): Promise<void> {
  for (const businessId of await businessesWithOpenClaims(now)) {
    try {
      const result = await sweepPaymentClaims(businessId, now);
      if (result.notReceived)
        console.info(`[worker] ${result.notReceived} payment claim(s) with no money yet`);
    } catch (error) {
      // One business's problem must not stop the others; the next tick tries again.
      console.error('[worker] payment claims failed for a business', error);
    }
  }
}
