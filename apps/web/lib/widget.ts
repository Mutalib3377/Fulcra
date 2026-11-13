import { getWidgetConfig, isAllowedWidgetOrigin, type WidgetConfig } from '@fulcra/core';

/** Widget settings are cached for a minute per key (the widget polls every few seconds). */
const cache = new Map<string, { config: WidgetConfig | null; at: number }>();

export async function widgetConfig(key: string): Promise<WidgetConfig | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.config;
  const config = await getWidgetConfig(key);
  cache.set(key, { config, at: Date.now() });
  return config;
}

/** CORS for the seller's site: only allowed websites may call with this key. */
export function corsHeaders(
  origin: string | null,
  config: WidgetConfig | null,
): HeadersInit | null {
  if (!config) return null;
  const allowLocal =
    process.env.NODE_ENV !== 'production' || process.env.WIDGET_ALLOW_LOCAL === 'true';
  if (
    !isAllowedWidgetOrigin(origin, {
      websiteHost: config.websiteHost,
      storeHost: config.storeHost,
      allowLocal,
    })
  )
    return null;
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
