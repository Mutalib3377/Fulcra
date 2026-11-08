import { connectCatalogSource, isCoreError } from '@fulcra/core';
import {
  exchangeShopifyCode,
  getShopifyAppConfig,
  ImportFetchError,
  readOAuthState,
  verifyShopifyCallback,
} from '@fulcra/integrations';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { dashboardUrl } from '@/lib/urls';
import { SHOPIFY_NONCE_COOKIE as NONCE_COOKIE } from '@/lib/shopify';

/**
 * Step 2: Shopify sends the seller back with a one-time code. We check Shopify's signature,
 * our signed state and the browser cookie, swap the code for an access token and save it
 * encrypted. The seller then imports from the import page.
 */
export async function GET(request: Request) {
  const done = (query: string) => {
    const response = NextResponse.redirect(dashboardUrl(`/catalog/import?${query}`), 303);
    response.cookies.delete({ name: NONCE_COOKIE, path: '/api/integrations/shopify' });
    return response;
  };
  const config = getShopifyAppConfig();
  if (!config) return done('error=shopify_not_set_up');
  const query = new URL(request.url).searchParams;
  if (query.get('error')) return done('error=shopify_cancelled');
  if (!verifyShopifyCallback(query, config.apiSecret)) return done('error=shopify_failed');

  const state = readOAuthState(query.get('state') ?? '', config.apiSecret);
  const nonce = request.headers
    .get('cookie')
    ?.match(new RegExp(`${NONCE_COOKIE}=([0-9a-f]+)`))?.[1];
  const user = await getCurrentUser();
  if (
    !state ||
    !nonce ||
    state.nonce !== nonce ||
    state.shop !== query.get('shop') ||
    user?.id !== state.userId
  ) {
    return done('error=shopify_failed');
  }
  try {
    const token = await exchangeShopifyCode({
      shop: state.shop,
      code: query.get('code') ?? '',
      config,
    });
    await connectCatalogSource(
      { businessId: state.businessId, userId: state.userId },
      { kind: 'shopify', shopUrl: state.shop, credentials: token },
    );
  } catch (error) {
    if (error instanceof ImportFetchError || isCoreError(error))
      return done('error=shopify_failed');
    throw error;
  }
  return done('connected=shopify');
}
