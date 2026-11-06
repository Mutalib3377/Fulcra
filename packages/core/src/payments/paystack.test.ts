import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPaystackSignature } from './paystack';

describe('verifyPaystackSignature', () => {
  const secret = 'sk_test_example';
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_1' } });
  const sign = (b: string, key = secret) => createHmac('sha512', key).update(b).digest('hex');

  it('accepts the correct signature only', () => {
    expect(verifyPaystackSignature(body, sign(body), secret)).toBe(true);
    expect(verifyPaystackSignature(body + ' ', sign(body), secret)).toBe(false);
    expect(verifyPaystackSignature(body, sign(body, 'sk_test_other'), secret)).toBe(false);
    expect(verifyPaystackSignature(body, null, secret)).toBe(false);
    expect(verifyPaystackSignature(body, 'abc', secret)).toBe(false);
  });
});
