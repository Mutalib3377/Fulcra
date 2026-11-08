import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportedProduct } from '@fulcra/db/schema';
import type * as QueueModule from '../src/jobs/queue';

const queued: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueCatalogImport: async (_businessId: string, importId: string) => {
    queued.push(importId);
  },
}));

const { schema, withSystem } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const { listProducts } = await import('../src/catalog/products');
const { getImport, processCatalogImport } = await import('../src/imports/imports');
const {
  claimImportFetch,
  connectCatalogSource,
  disconnectCatalogSource,
  failImportFetch,
  listCatalogSources,
  saveFetchedProducts,
  startSourceImport,
} = await import('../src/imports/sources');
const { processShopifyWebhook, recordShopifyWebhook } =
  await import('../src/imports/shopify-webhooks');
const { addMember, newBusiness, uniq } = await import('./helpers');

beforeEach(() => {
  queued.length = 0;
});

const shopify = (shop = `shop-${uniq()}.myshopify.com`) =>
  ({
    kind: 'shopify',
    shopUrl: shop,
    credentials: { accessToken: 'shpat_0123456789abcdef', scopes: 'read_products' },
  }) as const;

const product = (id: string, extra: Partial<ImportedProduct> = {}) => ({
  externalId: id,
  name: `Product ${id}`,
  description: '',
  category: 'Bags',
  retailPrice: 500_000,
  wholesalePrice: null,
  wholesaleMinQty: null,
  photoUrls: [],
  variants: [
    { externalId: `v${id}`, size: null, colour: null, sku: null, stock: 4, priceOverride: null },
  ],
  ...extra,
});

describe('shop connections', () => {
  it('stores keys encrypted and never lists them', async () => {
    const { actor } = await newBusiness('src');
    const view = await connectCatalogSource(actor, shopify('ada-styles.myshopify.com'));
    expect(view).toMatchObject({
      kind: 'shopify',
      status: 'connected',
      shopUrl: 'ada-styles.myshopify.com',
    });
    expect(Object.keys(view)).not.toContain('credentials');
    const [row] = await withSystem((tx) =>
      tx.select().from(schema.catalogSources).where(eq(schema.catalogSources.id, view.id)),
    );
    expect(row!.credentials).toMatch(/^v1:/);
    expect(row!.credentials).not.toContain('shpat_');
    expect(await listCatalogSources(actor)).toEqual([expect.objectContaining({ id: view.id })]);
  });

  it('checks shop addresses and keys, and reconnecting replaces the connection', async () => {
    const { actor } = await newBusiness('src');
    await expect(connectCatalogSource(actor, shopify('evil.com'))).rejects.toThrow();
    await expect(
      connectCatalogSource(actor, {
        kind: 'woocommerce',
        shopUrl: 'http://mystore.com',
        credentials: { consumerKey: 'ck_abc', consumerSecret: 'cs_abc' },
      }),
    ).rejects.toThrow('https://');
    const woo = {
      kind: 'woocommerce',
      shopUrl: 'https://mystore.com/',
      credentials: { consumerKey: 'ck_abc', consumerSecret: 'cs_abc' },
    } as const;
    const first = await connectCatalogSource(actor, woo);
    expect(first.shopUrl).toBe('https://mystore.com');
    const second = await connectCatalogSource(actor, { ...woo, shopUrl: 'https://other.com' });
    expect(second.id).toBe(first.id);
    expect(await listCatalogSources(actor)).toHaveLength(1);
    const rider = await addMember(actor, 'rider');
    await expect(connectCatalogSource(rider, woo)).rejects.toThrow();
  });
});

describe('importing from a shop', () => {
  it('fetches, saves without review, and updates on the next import', async () => {
    const { actor } = await newBusiness('src');
    await expect(startSourceImport(actor, 'shopify')).rejects.toThrow('Connect your shop first');
    const source = await connectCatalogSource(actor, shopify());
    const run = await startSourceImport(actor, 'shopify');
    expect(run).toMatchObject({
      kind: 'shopify',
      status: 'queued',
      sourceId: source.id,
      label: source.shopUrl,
    });
    expect(queued).toEqual([run.id]);
    await expect(startSourceImport(actor, 'shopify')).rejects.toThrow('already running');

    const target = await claimImportFetch(actor.businessId, run.id);
    expect(target).toEqual({
      kind: 'shopify',
      shopUrl: source.shopUrl,
      credentials: { accessToken: 'shpat_0123456789abcdef', scopes: 'read_products' },
    });
    const tooMany = product('3', {
      variants: Array.from({ length: 101 }, (_, i) => ({
        externalId: `x${i}`,
        size: `S${i}`,
        colour: null,
        sku: null,
        stock: 1,
        priceOverride: null,
      })),
    });
    await saveFetchedProducts(
      actor.businessId,
      run.id,
      [product('1'), product('2'), tooMany],
      [{ position: 1, message: 'Stock is not tracked in your shop, so it starts at 0.' }],
    );
    expect(await processCatalogImport(actor.businessId, run.id)).toBe('done');
    const view = await getImport(actor, run.id);
    expect(view.import).toMatchObject({
      status: 'done',
      createdCount: 2,
      failedCount: 1,
      totalItems: 2,
    });
    expect(view.items[2]).toMatchObject({ result: 'failed', decision: 'skipped' });
    expect(view.items[1]!.problems).toContainEqual({
      level: 'warning',
      message: 'Stock is not tracked in your shop, so it starts at 0.',
    });
    const [synced] = await listCatalogSources(actor);
    expect(synced!.lastSyncedAt).not.toBeNull();
    expect((await listProducts(actor)).map((p) => p.name).sort()).toEqual([
      'Product 1',
      'Product 2',
    ]);

    const again = await startSourceImport(actor, 'shopify');
    await claimImportFetch(actor.businessId, again.id);
    await saveFetchedProducts(actor.businessId, again.id, [
      product('1', { name: 'Renamed 1', retailPrice: 600_000 }),
    ]);
    await processCatalogImport(actor.businessId, again.id);
    expect((await getImport(actor, again.id)).import).toMatchObject({
      createdCount: 0,
      updatedCount: 1,
    });
    const products = await listProducts(actor);
    expect(products).toHaveLength(2);
    expect(products.find((p) => p.name === 'Renamed 1')?.retailPrice).toBe(600_000);
  });

  it('marks the connection when the shop cannot be read, and clears it after a good import', async () => {
    const { actor } = await newBusiness('src');
    await connectCatalogSource(actor, shopify());
    const run = await startSourceImport(actor, 'shopify');
    await claimImportFetch(actor.businessId, run.id);
    await failImportFetch(
      actor.businessId,
      run.id,
      'Shopify did not accept the connection. Connect again.',
    );
    expect((await getImport(actor, run.id)).import).toMatchObject({ status: 'failed' });
    expect((await listCatalogSources(actor))[0]).toMatchObject({
      status: 'error',
      lastError: 'Shopify did not accept the connection. Connect again.',
    });
    const next = await startSourceImport(actor, 'shopify');
    await claimImportFetch(actor.businessId, next.id);
    await saveFetchedProducts(actor.businessId, next.id, [product('9')]);
    await processCatalogImport(actor.businessId, next.id);
    expect((await listCatalogSources(actor))[0]).toMatchObject({
      status: 'connected',
      lastError: null,
    });
  });

  it('disconnecting forgets the keys; a queued import then fails', async () => {
    const { actor } = await newBusiness('src');
    await connectCatalogSource(actor, shopify());
    const run = await startSourceImport(actor, 'shopify');
    await disconnectCatalogSource(actor, 'shopify');
    expect(await claimImportFetch(actor.businessId, run.id)).toBeNull();
    expect((await getImport(actor, run.id)).import).toMatchObject({
      status: 'failed',
      error: 'The shop was disconnected.',
    });
    await expect(startSourceImport(actor, 'shopify')).rejects.toThrow('Connect your shop first');
  });

  it("never gives one business another's shop keys", async () => {
    const one = await newBusiness('src');
    const two = await newBusiness('src');
    await connectCatalogSource(one.actor, shopify());
    const run = await startSourceImport(one.actor, 'shopify');
    expect(await claimImportFetch(two.business.id, run.id)).toBeNull();
    expect(await listCatalogSources(two.actor)).toEqual([]);
  });
});

describe('Shopify webhooks', () => {
  const secret = 'shpss_test_secret';
  const env = { SHOPIFY_API_SECRET: secret };
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64');

  it('verifies, saves once and disconnects every business using the removed shop', async () => {
    const shop = `gone-${uniq()}.myshopify.com`;
    const one = await newBusiness('src');
    const two = await newBusiness('src');
    await connectCatalogSource(one.actor, shopify(shop));
    await connectCatalogSource(two.actor, shopify(shop));
    const body = JSON.stringify({ id: 1, domain: shop });
    const headers = { hmac: sign(body), topic: 'app/uninstalled', shop, webhookId: randomUUID() };

    expect(await recordShopifyWebhook(body, { ...headers, hmac: sign('other') }, env)).toEqual({
      status: 'invalid_signature',
    });
    expect(await recordShopifyWebhook(body, headers, {})).toEqual({ status: 'not_configured' });
    expect(await recordShopifyWebhook(body, { ...headers, topic: 'orders/create' }, env)).toEqual({
      status: 'bad_payload',
    });
    const saved = await recordShopifyWebhook(body, headers, env);
    expect(saved.status).toBe('saved');
    const id = (saved as { webhookEventId: string }).webhookEventId;
    expect(await recordShopifyWebhook(body, headers, env)).toEqual({
      status: 'duplicate',
      webhookEventId: id,
      processed: false,
    });

    expect(await processShopifyWebhook(id)).toBe('processed');
    expect(await processShopifyWebhook(id)).toBe('already_processed');
    for (const actor of [one.actor, two.actor]) {
      expect((await listCatalogSources(actor))[0]).toMatchObject({
        status: 'disconnected',
        lastError: 'Fulcra was removed from this Shopify store.',
      });
    }
    expect(await recordShopifyWebhook(body, headers, env)).toEqual({
      status: 'duplicate',
      webhookEventId: id,
      processed: true,
    });
  });

  it('records privacy requests (we keep no Shopify customer data)', async () => {
    const shop = `p-${uniq()}.myshopify.com`;
    const body = JSON.stringify({ shop_domain: shop, customer: { id: 5 } });
    const saved = await recordShopifyWebhook(
      body,
      { hmac: sign(body), topic: 'customers/redact', shop, webhookId: null },
      env,
    );
    expect(saved.status).toBe('saved');
    expect(await processShopifyWebhook((saved as { webhookEventId: string }).webhookEventId)).toBe(
      'processed',
    );
  });
});
