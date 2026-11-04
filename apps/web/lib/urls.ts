import { DASHBOARD_SUBDOMAIN } from '@fulcra/config';
import { getRootDomain } from './host-routing';

function protocolFor(rootDomain: string) {
  return rootDomain.startsWith('localhost') ? 'http:' : 'https:';
}

/** Absolute URL on the dashboard host, e.g. https://app.yourdomain.com/invite/abc. */
export function dashboardUrl(path = '/'): string {
  const root = getRootDomain();
  return `${protocolFor(root)}//${DASHBOARD_SUBDOMAIN}.${root}${path}`;
}

/** Absolute URL of a business's store, e.g. https://mama-ada.yourdomain.com. */
export function storeUrl(subdomain: string, path = '/'): string {
  const root = getRootDomain();
  return `${protocolFor(root)}//${subdomain}.${root}${path === '/' ? '' : path}`;
}

/** The store host shown to users, without protocol: mama-ada.yourdomain.com */
export function storeHost(subdomain: string): string {
  return `${subdomain}.${getRootDomain().replace(/:\d+$/, '')}`;
}

/** Only allow redirects to paths on our own dashboard (prevents open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}
