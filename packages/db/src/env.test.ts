import { describe, expect, it } from 'vitest';
import { getDatabaseUrl } from './env';

describe('getDatabaseUrl', () => {
  it('returns a valid postgres url', () => {
    const url = 'postgres://postgres:postgres@localhost:54322/fulcra';
    expect(getDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it('throws a helpful error when missing or not postgres', () => {
    expect(() => getDatabaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => getDatabaseUrl({ DATABASE_URL: 'https://example.com' })).toThrow(/DATABASE_URL/);
  });
});
