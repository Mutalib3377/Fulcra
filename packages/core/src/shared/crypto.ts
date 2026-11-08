import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts secrets we must keep (shop access keys, later channel tokens) with AES-256-GCM
 * and ENCRYPTION_KEY (32 bytes, base64). Format: "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 * Never log or return decrypted values to the browser.
 */
function getKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be 32 bytes, base64. Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

export function encryptSecret(plain: string, env?: NodeJS.ProcessEnv): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(env), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join(':');
}

export function decryptSecret(sealed: string, env?: NodeJS.ProcessEnv): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined)
    throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', getKey(env), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
