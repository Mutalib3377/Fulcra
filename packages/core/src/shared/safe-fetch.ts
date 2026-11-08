import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { CoreError } from './errors';

/**
 * Downloads from a public web address only. Used for anything fetched from a link a seller
 * gives us (product photos, websites), so the server cannot be pointed at internal
 * addresses (cloud metadata, the database, localhost). Limits size, time and redirects.
 *
 * Local development can allow private addresses with FETCH_ALLOW_PRIVATE_HOSTS=true
 * (ignored in production).
 */
export type SafeFetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  accept?: string;
  env?: NodeJS.ProcessEnv;
};

export type SafeFetchResult = { url: string; contentType: string; body: Uint8Array };

const MAX_REDIRECTS = 3;

function ipv4Blocked(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

/** True for addresses that are not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Blocked(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return ipv4Blocked(mapped[1]!);
  return (
    v6 === '::' ||
    v6 === '::1' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe8') ||
    v6.startsWith('fe9') ||
    v6.startsWith('fea') ||
    v6.startsWith('feb') ||
    v6.startsWith('ff')
  );
}

function allowPrivate(env: NodeJS.ProcessEnv): boolean {
  return env.FETCH_ALLOW_PRIVATE_HOSTS === 'true' && env.NODE_ENV !== 'production';
}

async function checkUrl(raw: string, env: NodeJS.ProcessEnv): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CoreError('validation', 'This is not a valid web link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CoreError('validation', 'Only http and https links can be used.');
  }
  if (url.username || url.password) {
    throw new CoreError('validation', 'Links with a password in them cannot be used.');
  }
  if (allowPrivate(env)) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((list) => list.map((a) => a.address))
        .catch(() => {
          throw new CoreError('validation', `We could not find the website "${host}".`);
        });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new CoreError('validation', 'This link points to a private address and cannot be used.');
  }
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new CoreError('validation', 'The file at this link is too large.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CoreError('validation', 'The file at this link is too large.');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const env = options.env ?? process.env;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(current, env);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': 'FulcraBot/1.0 (+catalog import)',
          accept: options.accept ?? '*/*',
        },
      });
    } catch {
      throw new CoreError(
        'validation',
        'The link did not respond. Check it opens in your browser.',
      );
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location')!, url).href;
      continue;
    }
    if (!response.ok) {
      throw new CoreError('validation', `The link returned an error (${response.status}).`);
    }
    return {
      url: url.href,
      contentType: response.headers.get('content-type') ?? '',
      body: await readLimited(response, options.maxBytes),
    };
  }
  throw new CoreError('validation', 'The link redirects too many times.');
}
