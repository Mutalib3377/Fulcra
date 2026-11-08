import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

const env = { ENCRYPTION_KEY: randomBytes(32).toString('base64') };

describe('encryptSecret', () => {
  it('round-trips and never shows the secret', () => {
    const sealed = encryptSecret('shpat_secret_token', env);
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('shpat');
    expect(encryptSecret('shpat_secret_token', env)).not.toBe(sealed); // fresh IV each time
    expect(decryptSecret(sealed, env)).toBe('shpat_secret_token');
  });

  it('refuses tampered data, a wrong key or a missing key', () => {
    const sealed = encryptSecret('abc', env);
    const parts = sealed.split(':');
    parts[3] = Buffer.from('xyz').toString('base64');
    expect(() => decryptSecret(parts.join(':'), env)).toThrow();
    expect(() =>
      decryptSecret(sealed, { ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    ).toThrow();
    expect(() => encryptSecret('abc', {})).toThrow('ENCRYPTION_KEY');
  });
});
