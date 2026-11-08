import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SHOPIFY_SHOP_PATTERN } from '@fulcra/core';
import { ImportFetchError } from '../shared';

/** What our Shopify app asks for: read products and stock only. */
export const SHOPIFY_SCOPES = 'read_products,read_inventory';

export type ShopifyAppConfig = { apiKey: string; apiSecret: string };

/** Our Shopify app's keys, or null when Shopify connections are not set up yet. */
export function getShopifyAppConfig(env: NodeJS.ProcessEnv = process.env): ShopifyAppConfig | null {
  const apiKey = env.SHOPIFY_API_KEY?.trim();
  const apiSecret = env.SHOPIFY_API_SECRET?.trim();
  return apiKey && apiSecret ? { apiKey, apiSecret } : null;
}

/**
 * Where a shop's admin is. Tests and local runs can point every shop at a fake server with
 * SHOPIFY_TEST_BASE_URL (ignored in production).
 */
export function shopBaseUrl(shop: string, env: NodeJS.ProcessEnv = process.env): string {
  const fake = env.SHOPIFY_TEST_BASE_URL;
  if (fake && env.NODE_ENV !== 'production') return fake.replace(/\/+$/, '');
  return `https://${shop}`;
}

/** "mystore", "mystore.myshopify.com" or a full admin link → "mystore.myshopify.com", or null. */
export function normalizeShopDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^admin\.shopify\.com\/store\//, '');
  value = value.split(/[/?#]/)[0] ?? '';
  if (/^[a-z0-9][a-z0-9-]*$/.test(value)) value = `${value}.myshopify.com`;
  return SHOPIFY_SHOP_PATTERN.test(value) ? value : null;
}

export function shopifyAuthorizeUrl(params: {
  shop: string;
  apiKey: string;
  redirectUri: string;
  state: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const url = new URL(`${shopBaseUrl(params.shop, params.env)}/admin/oauth/authorize`);
  url.searchParams.set('client_id', params.apiKey);
  url.searchParams.set('scope', SHOPIFY_SCOPES);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

/** Shopify signs the callback: hex HMAC-SHA256 of the other parameters, sorted. */
export function verifyShopifyCallback(query: URLSearchParams, apiSecret: string): boolean {
  const hmac = query.get('hmac');
  if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac)) return false;
  const message = [...query.entries()]
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const expected = createHmac('sha256', apiSecret).update(message).digest();
  const given = Buffer.from(hmac, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The `state` we send to Shopify and get back: who started the connection, for which shop,
 * until when. Signed so it cannot be forged; the nonce is also kept in a cookie so the
 * callback must come back to the same browser.
 */
export type OAuthState = {
  businessId: string;
  userId: string;
  shop: string;
  nonce: string;
  expiresAt: number;
};

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

export function createOAuthState(
  data: Omit<OAuthState, 'nonce' | 'expiresAt'>,
  apiSecret: string,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const payload = b64url(JSON.stringify({ ...data, nonce, expiresAt: now + 10 * 60_000 }));
  const signature = b64url(createHmac('sha256', apiSecret).update(payload).digest());
  return { state: `${payload}.${signature}`, nonce };
}

export function readOAuthState(
  state: string,
  apiSecret: string,
  now = Date.now(),
): OAuthState | null {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', apiSecret).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    return data.expiresAt > now ? data : null;
  } catch {
    return null;
  }
}

/** Swaps the one-time code from the callback for the shop's access token. */
export async function exchangeShopifyCode(params: {
  shop: string;
  code: string;
  config: ShopifyAppConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<{ accessToken: string; scopes: string }> {
  let response: Response;
  try {
    response = await fetch(`${shopBaseUrl(params.shop, params.env)}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: params.config.apiKey,
        client_secret: params.config.apiSecret,
        code: params.code,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ImportFetchError('Shopify did not respond. Please try connecting again.');
  }
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    scope?: string;
  } | null;
  if (!response.ok || !body?.access_token) {
    throw new ImportFetchError('Shopify did not accept the connection. Please try again.');
  }
  return { accessToken: body.access_token, scopes: body.scope ?? '' };
}
