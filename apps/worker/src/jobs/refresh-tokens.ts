import { InstagramApiError, refreshInstagramToken } from '@fulcra/channels';
import {
  connectionToken,
  instagramTokensToRefresh,
  markConnectionError,
  saveRenewedToken,
} from '@fulcra/core';

/** Daily: renews Instagram tokens that run out within 15 days. */
export async function handleRefreshChannelTokens(): Promise<void> {
  for (const { businessId, connectionId } of await instagramTokensToRefresh()) {
    const token = await connectionToken(businessId, connectionId);
    if (!token) continue;
    try {
      await saveRenewedToken(businessId, connectionId, await refreshInstagramToken(token));
      console.info(`[worker] Instagram token renewed for ${connectionId}`);
    } catch (error) {
      if (error instanceof InstagramApiError && error.code === 190) {
        await markConnectionError(
          businessId,
          connectionId,
          'Instagram stopped accepting our access. Connect Instagram again.',
        );
        continue;
      }
      console.error(`[worker] could not renew Instagram token for ${connectionId}`, error);
    }
  }
}
