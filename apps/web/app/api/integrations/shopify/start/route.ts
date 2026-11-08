import {
  createOAuthState,
  getShopifyAppConfig,
  normalizeShopDomain,
  shopifyAuthorizeUrl,
} from '@fulcra/integrations';
import { NextResponse } from 'next/server';
import { getActionContext } from '@/lib/auth';
import { dashboardUrl } from '@/lib/urls';

import { SHOPIFY_NONCE_COOKIE as NONCE_COOKIE } from '@/lib/shopify';

const back = (error: string) =>
  NextResponse.redirect(dashboardUrl(`/catalog/import?error=${error}`), 303);

/**
 * Step 1 of connecting Shopify: the seller typed their shop; send them to Shopify to
 * approve our app (read products and stock). A plain GET form posts here, so it works
 * without JavaScript.
 */
export async function GET(request: Request) {
  const context = await getActionContext();
  if (!context) return NextResponse.redirect(dashboardUrl('/sign-in'), 303);
  if (context.membership.role === 'rider') return back('not_allowed');
  const config = getShopifyAppConfig();
  if (!config) return back('shopify_not_set_up');
  const shop = normalizeShopDomain(new URL(request.url).searchParams.get('shop') ?? '');
  if (!shop) return back('shopify_bad_shop');

  const { state, nonce } = createOAuthState(
    { businessId: context.actor.businessId, userId: context.actor.userId, shop },
    config.apiSecret,
  );
  const response = NextResponse.redirect(
    shopifyAuthorizeUrl({
      shop,
      apiKey: config.apiKey,
      redirectUri: dashboardUrl('/api/integrations/shopify/callback'),
      state,
    }),
    303,
  );
  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: dashboardUrl('/').startsWith('https:'),
    path: '/api/integrations/shopify',
    maxAge: 600,
  });
  return response;
}
