import { describe, expect, it } from 'vitest';
import { dashboardUrl, safeNextPath, storeHost, storeUrl } from './urls';

describe('urls', () => {
  it('builds dashboard and store URLs from ROOT_DOMAIN', () => {
    process.env.ROOT_DOMAIN = 'localhost:3000';
    expect(dashboardUrl('/invite/x')).toBe('http://app.localhost:3000/invite/x');
    expect(storeUrl('mama-ada')).toBe('http://mama-ada.localhost:3000');
    expect(storeHost('mama-ada')).toBe('mama-ada.localhost');

    process.env.ROOT_DOMAIN = 'yourdomain.com';
    expect(dashboardUrl()).toBe('https://app.yourdomain.com/');
  });

  it('only allows local redirect paths', () => {
    expect(safeNextPath('/invite/abc')).toBe('/invite/abc');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
