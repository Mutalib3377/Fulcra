import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchWooCatalog, verifyWooConnection } from './products';

const credentials = { consumerKey: 'ck_123', consumerSecret: 'cs_456' };
const env = { FETCH_ALLOW_PRIVATE_HOSTS: 'true', NODE_ENV: 'test' };
let server: Server;
let base: string;
let currency = 'NGN';
let stripAuthHeader = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const header =
      req.headers.authorization === `Basic ${Buffer.from('ck_123:cs_456').toString('base64')}`;
    const query =
      url.searchParams.get('consumer_key') === 'ck_123' &&
      url.searchParams.get('consumer_secret') === 'cs_456';
    res.setHeader('content-type', 'application/json');
    if (!url.pathname.startsWith('/wp-json/wc/v3')) return res.writeHead(404).end('{}');
    if (!((header && !stripAuthHeader) || query))
      return res.writeHead(401).end('{"code":"woocommerce_rest_cannot_view"}');
    const path = url.pathname.replace('/wp-json/wc/v3', '');
    if (path === '/data/currencies/current') return res.end(JSON.stringify({ code: currency }));
    if (path === '/products') {
      res.setHeader('x-wp-totalpages', '1');
      return res.end(
        JSON.stringify([
          {
            id: 1,
            name: 'Shea Butter',
            type: 'simple',
            price: '4500',
            sku: 'SB',
            manage_stock: true,
            stock_quantity: 12,
            categories: [{ name: 'Uncategorized' }, { name: 'Skin' }],
            images: [{ src: 'https://site/a.jpg' }],
            description: '<p>Pure</p>',
          },
          {
            id: 2,
            name: 'Agbada',
            type: 'variable',
            price: '30000',
            manage_stock: false,
            categories: [],
            images: [],
            description: '',
            short_description: 'Hand made',
          },
          { id: 3, name: 'Gift set', type: 'grouped', price: '0', categories: [], images: [] },
          {
            id: 4,
            name: 'Wrap',
            type: 'simple',
            price: '2000',
            manage_stock: false,
            categories: [],
            images: [],
          },
        ]),
      );
    }
    if (path === '/products/2/variations') {
      return res.end(
        JSON.stringify([
          {
            id: 21,
            price: '30000',
            manage_stock: true,
            stock_quantity: 2,
            attributes: [
              { name: 'Size', option: 'L' },
              { name: 'Colour', option: 'Blue' },
            ],
            image: { src: 'https://site/blue.jpg' },
          },
          {
            id: 22,
            price: '35000',
            manage_stock: 'parent',
            stock_quantity: null,
            attributes: [
              { name: 'Size', option: 'XL' },
              { name: 'Colour', option: 'Blue' },
            ],
          },
        ]),
      );
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('WooCommerce', () => {
  it('checks the keys, also when the host strips the Authorization header', async () => {
    expect(await verifyWooConnection({ shopUrl: base, credentials }, env)).toEqual({
      currency: 'NGN',
    });
    stripAuthHeader = true;
    expect(await verifyWooConnection({ shopUrl: base, credentials }, env)).toEqual({
      currency: 'NGN',
    });
    stripAuthHeader = false;
    await expect(
      verifyWooConnection(
        { shopUrl: base, credentials: { consumerKey: 'ck_bad', consumerSecret: 'cs_bad' } },
        env,
      ),
    ).rejects.toThrow('keys were not accepted');
    await expect(
      verifyWooConnection({ shopUrl: `${base}/shop`, credentials }, env),
    ).rejects.toThrow('could not find WooCommerce');
  });

  it('reads simple and variable products, skipping grouped ones', async () => {
    const catalog = await fetchWooCatalog({ shopUrl: base, credentials }, env);
    expect(catalog.products.map((p) => p.name)).toEqual(['Shea Butter', 'Agbada', 'Wrap']);
    expect(catalog.products[0]).toMatchObject({
      externalId: '1',
      category: 'Skin',
      description: 'Pure',
      retailPrice: 450_000,
      photoUrls: ['https://site/a.jpg'],
      variants: [
        { externalId: '1', size: null, colour: null, sku: 'SB', stock: 12, priceOverride: null },
      ],
    });
    expect(catalog.products[1]).toMatchObject({
      description: 'Hand made',
      retailPrice: 3_000_000,
      photoUrls: ['https://site/blue.jpg'],
    });
    expect(catalog.products[1]!.variants).toEqual([
      { externalId: '21', size: 'L', colour: 'Blue', sku: null, stock: 2, priceOverride: null },
      {
        externalId: '22',
        size: 'XL',
        colour: 'Blue',
        sku: null,
        stock: null,
        priceOverride: 3_500_000,
      },
    ]);
    expect(catalog.notes.map((n) => n.position)).toEqual([1, 2]);
  });

  it('refuses shops that do not sell in Naira', async () => {
    currency = 'USD';
    await expect(fetchWooCatalog({ shopUrl: base, credentials }, env)).rejects.toThrow(
      'sells in USD',
    );
    currency = 'NGN';
  });
});
