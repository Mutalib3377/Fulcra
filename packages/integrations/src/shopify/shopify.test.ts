import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOAuthState,
  exchangeShopifyCode,
  normalizeShopDomain,
  readOAuthState,
  shopifyAuthorizeUrl,
  verifyShopifyCallback,
} from './oauth';
import { fetchShopifyCatalog } from './products';

const secret = 'shpss_secret';

describe('Shopify connection', () => {
  it('understands the ways sellers type their shop', () => {
    expect(normalizeShopDomain('Ada-Styles')).toBe('ada-styles.myshopify.com');
    expect(normalizeShopDomain('https://ada-styles.myshopify.com/admin')).toBe(
      'ada-styles.myshopify.com',
    );
    expect(normalizeShopDomain('admin.shopify.com/store/ada-styles')).toBe(
      'ada-styles.myshopify.com',
    );
    expect(normalizeShopDomain('evil.com')).toBeNull();
    expect(normalizeShopDomain('a.myshopify.com.evil.com')).toBeNull();
  });

  it('checks Shopify’s callback signature', () => {
    const query = new URLSearchParams({
      code: 'abc',
      shop: 'a.myshopify.com',
      state: 's',
      timestamp: '1',
    });
    const message = 'code=abc&shop=a.myshopify.com&state=s&timestamp=1';
    query.set('hmac', createHmac('sha256', secret).update(message).digest('hex'));
    expect(verifyShopifyCallback(query, secret)).toBe(true);
    query.set('code', 'changed');
    expect(verifyShopifyCallback(query, secret)).toBe(false);
  });

  it('signs the state and refuses tampered or old ones', () => {
    const { state, nonce } = createOAuthState(
      { businessId: 'b', userId: 'u', shop: 'a.myshopify.com' },
      secret,
      1000,
    );
    expect(readOAuthState(state, secret, 2000)).toMatchObject({
      businessId: 'b',
      shop: 'a.myshopify.com',
      nonce,
    });
    expect(readOAuthState(state, 'other', 2000)).toBeNull();
    expect(readOAuthState(state.replace(/^./, 'x'), secret, 2000)).toBeNull();
    expect(readOAuthState(state, secret, 1000 + 11 * 60_000)).toBeNull();
    const url = new URL(
      shopifyAuthorizeUrl({
        shop: 'a.myshopify.com',
        apiKey: 'key',
        redirectUri: 'https://app/cb',
        state,
      }),
    );
    expect(url.origin).toBe('https://a.myshopify.com');
    expect(url.searchParams.get('scope')).toBe('read_products,read_inventory');
  });
});

let server: Server;
let base: string;
let calls = 0;
let mode: 'ok' | 'usd' | 'denied' = 'ok';

const product = (id: string, variants: object[], extra = {}) => ({
  legacyResourceId: id,
  title: `Product ${id}`,
  descriptionHtml: '<p>Nice</p>',
  productType: 'Bags',
  media: { nodes: [{ image: { url: `https://cdn.shopify.com/${id}.jpg` } }, {}] },
  variants: { nodes: variants },
  ...extra,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/admin/oauth/access_token') {
        const { code } = JSON.parse(body) as { code: string };
        if (code !== 'good') return res.writeHead(400).end('{}');
        return res.end(
          JSON.stringify({ access_token: 'shpat_token', scope: 'read_products,read_inventory' }),
        );
      }
      if (req.headers['x-shopify-access-token'] !== 'shpat_token' || mode === 'denied')
        return res.writeHead(401).end('{}');
      calls++;
      if (calls === 1)
        return res.end(
          JSON.stringify({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }),
        );
      const { variables } = JSON.parse(body) as { variables: { cursor: string | null } };
      const currencyCode = mode === 'usd' ? 'USD' : 'NGN';
      const page = !variables.cursor
        ? {
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
            nodes: [
              product('1', [
                {
                  legacyResourceId: '11',
                  sku: 'T1',
                  price: '5000.00',
                  inventoryQuantity: 3,
                  inventoryItem: { tracked: true },
                  selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                },
              ]),
            ],
          }
        : {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              product('2', [
                {
                  legacyResourceId: '21',
                  sku: null,
                  price: '25000.00',
                  inventoryQuantity: -2,
                  inventoryItem: { tracked: true },
                  selectedOptions: [
                    { name: 'Size', value: 'M' },
                    { name: 'Color', value: 'Red' },
                  ],
                },
                {
                  legacyResourceId: '22',
                  sku: null,
                  price: '27000.00',
                  inventoryQuantity: 0,
                  inventoryItem: { tracked: false },
                  selectedOptions: [
                    { name: 'Size', value: 'L' },
                    { name: 'Color', value: 'Red' },
                  ],
                },
              ]),
            ],
          };
      res.end(JSON.stringify({ data: { shop: { currencyCode }, products: page } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('Shopify products', () => {
  const env = () => ({ SHOPIFY_TEST_BASE_URL: base, NODE_ENV: 'test' });
  const config = { apiKey: 'key', apiSecret: secret };

  it('exchanges the code for a token', async () => {
    expect(
      await exchangeShopifyCode({ shop: 'a.myshopify.com', code: 'good', config, env: env() }),
    ).toEqual({
      accessToken: 'shpat_token',
      scopes: 'read_products,read_inventory',
    });
    await expect(
      exchangeShopifyCode({ shop: 'a.myshopify.com', code: 'bad', config, env: env() }),
    ).rejects.toThrow('did not accept');
  });

  it('reads every page, waits when throttled and maps options, prices and stock', async () => {
    calls = 0;
    mode = 'ok';
    const catalog = await fetchShopifyCatalog(
      'a.myshopify.com',
      { accessToken: 'shpat_token', scopes: '' },
      env(),
    );
    expect(catalog.products.map((p) => p.externalId)).toEqual(['1', '2']);
    expect(catalog.products[0]).toMatchObject({
      name: 'Product 1',
      description: 'Nice',
      category: 'Bags',
      retailPrice: 500_000,
      photoUrls: ['https://cdn.shopify.com/1.jpg'],
      variants: [
        { externalId: '11', size: null, colour: null, sku: 'T1', stock: 3, priceOverride: null },
      ],
    });
    expect(catalog.products[1]!.variants).toEqual([
      { externalId: '21', size: 'M', colour: 'Red', sku: null, stock: 0, priceOverride: null },
      {
        externalId: '22',
        size: 'L',
        colour: 'Red',
        sku: null,
        stock: null,
        priceOverride: 2_700_000,
      },
    ]);
    expect(catalog.notes).toEqual([
      { position: 1, message: expect.stringContaining("Stock isn't tracked") },
    ]);
  }, 20_000);

  it('explains a non-Naira shop and a revoked connection', async () => {
    calls = 1;
    mode = 'usd';
    await expect(
      fetchShopifyCatalog('a.myshopify.com', { accessToken: 'shpat_token', scopes: '' }, env()),
    ).rejects.toThrow('sells in USD');
    mode = 'denied';
    await expect(
      fetchShopifyCatalog('a.myshopify.com', { accessToken: 'shpat_token', scopes: '' }, env()),
    ).rejects.toThrow('Connect your shop again');
  });
});
