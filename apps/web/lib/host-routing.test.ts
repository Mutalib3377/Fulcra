import { describe, expect, it } from 'vitest';
import { getRootDomain, resolveHost, rewritePath } from './host-routing';

describe('resolveHost (local: localhost:3000)', () => {
  const root = 'localhost:3000';

  it('sends the root domain to marketing', () => {
    expect(resolveHost('localhost:3000', root)).toEqual({ kind: 'marketing' });
  });

  it('sends app. to the dashboard', () => {
    expect(resolveHost('app.localhost:3000', root)).toEqual({ kind: 'dashboard' });
  });

  it('sends other subdomains to a store, case-insensitively', () => {
    expect(resolveHost('Test.localhost:3000', root)).toEqual({ kind: 'store', subdomain: 'test' });
  });

  it('redirects www to the root domain', () => {
    expect(resolveHost('www.localhost:3000', root)).toEqual({ kind: 'redirect-root' });
  });

  it('returns not-found for reserved words, nested and invalid subdomains', () => {
    for (const host of [
      'api.localhost:3000',
      'admin.localhost:3000',
      'a.b.localhost:3000',
      '-x.localhost:3000',
    ]) {
      expect(resolveHost(host, root)).toEqual({ kind: 'not-found' });
    }
  });

  it('falls back to marketing for unknown or missing hosts', () => {
    expect(resolveHost('fulcra-web.onrender.com', root)).toEqual({ kind: 'marketing' });
    expect(resolveHost(null, root)).toEqual({ kind: 'marketing' });
  });
});

describe('resolveHost (production)', () => {
  const root = 'yourdomain.com';

  it('routes by subdomain regardless of port', () => {
    expect(resolveHost('yourdomain.com', root)).toEqual({ kind: 'marketing' });
    expect(resolveHost('app.yourdomain.com', root)).toEqual({ kind: 'dashboard' });
    expect(resolveHost('mama-ada.yourdomain.com:443', root)).toEqual({
      kind: 'store',
      subdomain: 'mama-ada',
    });
  });

  it('does not treat look-alike domains as ours', () => {
    expect(resolveHost('evilyourdomain.com', root)).toEqual({ kind: 'marketing' });
  });
});

describe('rewritePath', () => {
  it('prefixes dashboard and store paths', () => {
    expect(rewritePath({ kind: 'dashboard' }, '/')).toBe('/dashboard');
    expect(rewritePath({ kind: 'dashboard' }, '/orders')).toBe('/dashboard/orders');
    expect(rewritePath({ kind: 'store', subdomain: 'test' }, '/')).toBe('/store/test');
    expect(rewritePath({ kind: 'store', subdomain: 'test' }, '/p/shoe')).toBe('/store/test/p/shoe');
  });

  it('serves marketing paths as-is but hides internal prefixes', () => {
    expect(rewritePath({ kind: 'marketing' }, '/pricing')).toBeNull();
    expect(rewritePath({ kind: 'marketing' }, '/dashboard')).toBe('/404');
    expect(rewritePath({ kind: 'marketing' }, '/store/test')).toBe('/404');
    expect(rewritePath({ kind: 'marketing' }, '/storefront')).toBeNull();
  });
});

describe('getRootDomain', () => {
  it('uses the env value, falling back to the placeholder domain', () => {
    expect(getRootDomain({ ROOT_DOMAIN: 'localhost:3000' })).toBe('localhost:3000');
    expect(getRootDomain({})).toBe('yourdomain.com');
  });
});
