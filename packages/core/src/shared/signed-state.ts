import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A signed, short-lived "state" for login redirects (Instagram, …): it carries who started
 * the connection and a nonce that must match a browser cookie, so a callback can't be forged
 * or replayed by someone else.
 */
export function createSignedState<T extends Record<string, unknown>>(
  data: T,
  secret: string,
  now = Date.now(),
): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('hex');
  const payload = Buffer.from(
    JSON.stringify({ ...data, nonce, expiresAt: now + 10 * 60_000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { state: `${payload}.${signature}`, nonce };
}

export function readSignedState<T extends Record<string, unknown>>(
  state: string,
  secret: string,
  now = Date.now(),
): (T & { nonce: string; expiresAt: number }) | null {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & {
      nonce: string;
      expiresAt: number;
    };
    return data.expiresAt > now ? data : null;
  } catch {
    return null;
  }
}
