import { DASHBOARD_SUBDOMAIN, DEFAULT_ROOT_DOMAIN, isReservedSubdomain } from '@fulcra/config';

/**
 * Where a request should go, based on its Host header.
 * - marketing: the root domain (yourdomain.com), and any unknown host
 * - dashboard: app.yourdomain.com
 * - store:     <subdomain>.yourdomain.com
 */
export type HostTarget =
  | { kind: 'marketing' }
  | { kind: 'dashboard' }
  | { kind: 'store'; subdomain: string }
  | { kind: 'redirect-root' }
  | { kind: 'not-found' };

/** Internal path prefixes the proxy rewrites to. Not reachable directly. */
export const DASHBOARD_PREFIX = '/dashboard';
export const STORE_PREFIX = '/store';

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSubdomain(value: string): boolean {
  return SUBDOMAIN_PATTERN.test(value);
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, '');
}

/** The root domain from env, e.g. `localhost:3000` locally or `yourdomain.com` in production. */
export function getRootDomain(env: Record<string, string | undefined> = process.env): string {
  return env.ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN;
}

export function resolveHost(hostHeader: string | null, rootDomain: string): HostTarget {
  if (!hostHeader) return { kind: 'marketing' };

  const host = stripPort(hostHeader.trim().toLowerCase());
  const root = stripPort(rootDomain.trim().toLowerCase());

  if (host === root) return { kind: 'marketing' };
  if (host === `www.${root}`) return { kind: 'redirect-root' };

  const suffix = `.${root}`;
  if (!host.endsWith(suffix)) {
    // Unknown host (e.g. the Render service URL or a raw IP): show marketing.
    return { kind: 'marketing' };
  }

  const subdomain = host.slice(0, -suffix.length);
  if (subdomain === DASHBOARD_SUBDOMAIN) return { kind: 'dashboard' };
  if (!isValidSubdomain(subdomain) || isReservedSubdomain(subdomain)) {
    return { kind: 'not-found' };
  }
  return { kind: 'store', subdomain };
}

/**
 * The internal path to rewrite to, or null to serve the path as-is.
 * Direct visits to the internal prefixes on the marketing host return 404.
 */
export function rewritePath(target: HostTarget, pathname: string): string | null {
  const path = pathname === '/' ? '' : pathname;
  switch (target.kind) {
    case 'dashboard':
      return `${DASHBOARD_PREFIX}${path}`;
    case 'store':
      return `${STORE_PREFIX}/${target.subdomain}${path}`;
    case 'marketing':
      return isInternalPath(pathname) ? '/404' : null;
    default:
      return null;
  }
}

function isInternalPath(pathname: string): boolean {
  return [DASHBOARD_PREFIX, STORE_PREFIX].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
