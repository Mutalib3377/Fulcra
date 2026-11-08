import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../src/jobs/queue';

const queued: string[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueCatalogImport: async (_businessId: string, importId: string) => {
    queued.push(importId);
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { listProducts } = await import('../src/catalog/products');
const { confirmImport, getImport, processCatalogImport } = await import('../src/imports/imports');
const { claimImportFetch, failImportFetch, saveFetchedProducts, startUrlImport } =
  await import('../src/imports/sources');
const { aiCallCostUsd, recordAiUsage } = await import('../src/usage/usage');
const { addMember, newBusiness } = await import('./helpers');

beforeEach(() => {
  queued.length = 0;
});

const product = (url: string, price: number) => ({
  externalId: url,
  name: `Item ${url.split('/').pop()}`,
  description: '',
  category: null,
  retailPrice: price,
  wholesalePrice: null,
  wholesaleMinQty: null,
  photoUrls: [],
  variants: [
    { externalId: null, size: null, colour: null, sku: null, stock: null, priceOverride: null },
  ],
});

describe('AI usage', () => {
  it('prices calls per model, never under-counting unknown models', () => {
    expect(aiCallCostUsd('claude-opus-5-5', { inputTokens: 1000, outputTokens: 500 })).toBe(0.014);
    expect(
      aiCallCostUsd('claude-opus-5-5', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
      }),
    ).toBe(0.2);
    expect(aiCallCostUsd('some-new-model', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(10);
  });

  it('logs the call against the business only', async () => {
    const one = await newBusiness('use');
    const two = await newBusiness('use');
    const row = await recordAiUsage(one.business.id, {
      feature: 'catalog_import.url',
      model: 'claude-opus-5-5',
      inputTokens: 12_000,
      outputTokens: 3_000,
    });
    expect(row).toMatchObject({
      kind: 'ai_call',
      feature: 'catalog_import.url',
      costUsd: 0.108,
      quantity: 1,
    });
    const seen = await withTenant(two.business.id, (tx) => tx.select().from(schema.usageRecords));
    expect(seen).toEqual([]);
  });
});

describe('website import', () => {
  it('reads in the background, waits for review, then saves', async () => {
    const { actor } = await newBusiness('url');
    const run = await startUrlImport(actor, { url: 'adastyles.com/shop' });
    expect(run).toMatchObject({
      kind: 'url',
      status: 'queued',
      label: 'https://adastyles.com/shop',
    });
    expect(queued).toEqual([run.id]);
    await expect(startUrlImport(actor, { url: 'adastyles.com' })).rejects.toThrow(
      'already reading',
    );

    expect(await claimImportFetch(actor.businessId, run.id)).toEqual({
      kind: 'url',
      url: 'https://adastyles.com/shop',
    });
    await saveFetchedProducts(
      actor.businessId,
      run.id,
      [product('https://adastyles.com/p/1', 500_000), product('https://adastyles.com/p/2', 0)],
      [
        {
          position: 1,
          level: 'error',
          message: "We couldn't find a price for this product on your website.",
        },
      ],
      { review: true, sourceRefs: ['/p/1', '/p/2'] },
    );
    const review = await getImport(actor, run.id);
    expect(review.import).toMatchObject({ status: 'review', totalItems: 2 });
    expect(review.items.map((i) => [i.sourceRef, i.decision, i.result])).toEqual([
      ['/p/1', 'approved', null],
      ['/p/2', 'skipped', null],
    ]);
    await confirmImport(actor, run.id);
    await processCatalogImport(actor.businessId, run.id);
    expect((await getImport(actor, run.id)).import).toMatchObject({
      status: 'done',
      createdCount: 1,
      skippedCount: 1,
    });
    const [saved] = await listProducts(actor);
    expect(saved).toMatchObject({ name: 'Item 1', retailPrice: 500_000 });

    // The website can be read again once the first run has finished.
    const again = await startUrlImport(actor, { url: 'adastyles.com' });
    await claimImportFetch(actor.businessId, again.id);
    await failImportFetch(actor.businessId, again.id, 'We could not open your website.');
    expect((await getImport(actor, again.id)).import).toMatchObject({
      status: 'failed',
      error: 'We could not open your website.',
    });
  });

  it('checks the address and who may import', async () => {
    const { actor } = await newBusiness('url');
    await expect(startUrlImport(actor, { url: 'nonsense' })).rejects.toThrow();
    const rider = await addMember(actor, 'rider');
    await expect(startUrlImport(rider, { url: 'adastyles.com' })).rejects.toThrow();
  });
});
