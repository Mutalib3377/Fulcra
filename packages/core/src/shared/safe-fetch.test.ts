import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPrivateAddress, safeFetch } from './safe-fetch';

let server: Server;
let base: string;
const dev = { FETCH_ALLOW_PRIVATE_HOSTS: 'true', NODE_ENV: 'test' };

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/big') return res.end('x'.repeat(2000));
    if (req.url === '/hop') {
      res.writeHead(302, { location: '/ok' });
      return res.end();
    }
    if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      return res.end();
    }
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('hello');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('isPrivateAddress', () => {
  it('blocks internal addresses and allows public ones', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '102.89.1.1', '172.32.0.1', '2a00:1450::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('safeFetch', () => {
  it('refuses private addresses unless allowed in development', async () => {
    await expect(safeFetch(`${base}/ok`, { maxBytes: 100, env: {} })).rejects.toThrow(
      'private address',
    );
    await expect(safeFetch('http://localhost/x', { maxBytes: 100, env: {} })).rejects.toThrow(
      'private address',
    );
    await expect(
      safeFetch(`${base}/ok`, { maxBytes: 100, env: { ...dev, NODE_ENV: 'production' } }),
    ).rejects.toThrow('private address');
  });

  it('refuses other protocols and links with passwords', async () => {
    await expect(safeFetch('file:///etc/passwd', { maxBytes: 100, env: dev })).rejects.toThrow(
      'Only http and https',
    );
    await expect(safeFetch('http://a:b@example.com/', { maxBytes: 100, env: dev })).rejects.toThrow(
      'password',
    );
  });

  it('follows a few redirects, limits size and reports errors', async () => {
    const ok = await safeFetch(`${base}/hop`, { maxBytes: 100, env: dev });
    expect(new TextDecoder().decode(ok.body)).toBe('hello');
    expect(ok.url).toBe(`${base}/ok`);
    await expect(safeFetch(`${base}/big`, { maxBytes: 100, env: dev })).rejects.toThrow(
      'too large',
    );
    await expect(safeFetch(`${base}/loop`, { maxBytes: 100, env: dev })).rejects.toThrow(
      'too many times',
    );
    await expect(safeFetch(`${base}/missing`, { maxBytes: 100, env: dev })).rejects.toThrow(
      '(404)',
    );
  });
});

describe('safeFetch headers', () => {
  it('sends headers to the same site only, and can return error statuses', async () => {
    const seen: (string | undefined)[] = [];
    const other = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.end('other');
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherBase = `http://localhost:${(other.address() as AddressInfo).port}`;
    const same = createServer((req, res) => {
      seen.push(req.headers.authorization);
      if (req.url === '/away') {
        res.writeHead(302, { location: `${otherBase}/x` });
        return res.end();
      }
      res.writeHead(req.url === '/denied' ? 401 : 200);
      res.end('ok');
    });
    await new Promise<void>((r) => same.listen(0, '127.0.0.1', r));
    const sameBase = `http://127.0.0.1:${(same.address() as AddressInfo).port}`;
    const headers = { authorization: 'Basic secret' };

    await safeFetch(`${sameBase}/away`, { maxBytes: 100, headers, env: dev });
    expect(seen).toEqual(['Basic secret', undefined]);
    const denied = await safeFetch(`${sameBase}/denied`, {
      maxBytes: 100,
      headers,
      allowErrorStatus: true,
      env: dev,
    });
    expect(denied.status).toBe(401);
    other.close();
    same.close();
  });
});
