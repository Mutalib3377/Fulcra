import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('accepts a postgres url and defaults NODE_ENV', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    expect(env.NODE_ENV).toBe('development');
  });

  it('names the missing variables', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
