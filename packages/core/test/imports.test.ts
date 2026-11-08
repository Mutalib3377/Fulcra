import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ImagesModule from '../src/media/images';
import type * as QueueModule from '../src/jobs/queue';

// No queue or file storage in tests: record what would be queued, fake the stored photo.
const queued: { businessId: string; importId: string }[] = [];
vi.mock('../src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueCatalogImport: async (businessId: string, importId: string) => {
    queued.push({ businessId, importId });
  },
}));
vi.mock('../src/media/images', async (original) => ({
  ...(await original<typeof ImagesModule>()),
  storeImage: async (businessId: string) => ({
    path: `${businessId}/${randomUUID()}`,
    width: 10,
    height: 10,
  }),
}));

const { getProduct, listProducts, setProductActive } = await import('../src/catalog/products');
const { listStockMovements } = await import('../src/catalog/stock');
const { listEvents } = await import('../src/events/events');
const {
  cancelImport,
  confirmImport,
  getImport,
  listImports,
  processCatalogImport,
  setImportItemsDecision,
  startCsvImport,
} = await import('../src/imports/imports');
const { setStoreChoice } = await import('../src/businesses/website');
const { getBusiness } = await import('../src/businesses/get-business');
const { addMember, newBusiness } = await import('./helpers');

let server: Server;
let photoBase: string;
beforeAll(async () => {
  process.env.FETCH_ALLOW_PRIVATE_HOSTS = 'true';
  server = createServer((req, res) => {
    if (req.url?.startsWith('/ok')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(Buffer.from('fake-png'));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  photoBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  delete process.env.FETCH_ALLOW_PRIVATE_HOSTS;
});
beforeEach(() => {
  queued.length = 0;
});

const CSV = (photo = '') =>
  [
    'name,price,size,colour,stock,sku,photos,product code,category',
    `Ankara Dress,25000,S,Red,5,AD-S,${photo},AD,Dresses`,
    'Ankara Dress,27000,M,Red,2,AD-M,,AD,Dresses',
    'Cap,3000,,,10,,,CAP,',
    'Broken,abc,,,1,,,BRK,',
  ].join('\n');

async function runImport(actor: { businessId: string; userId: string }, text: string) {
  const started = await startCsvImport(actor, { fileName: 'products.csv', text });
  await confirmImport(actor, started.id);
  await processCatalogImport(actor.businessId, started.id);
  return getImport(actor, started.id);
}

describe('CSV import', () => {
  it('opens a review with problem products unticked', async () => {
    const { actor } = await newBusiness('imp');
    const started = await startCsvImport(actor, { fileName: 'products.csv', text: CSV() });
    expect(started).toMatchObject({
      kind: 'csv',
      status: 'review',
      label: 'products.csv',
      totalItems: 3,
    });
    const view = await getImport(actor, started.id);
    expect(view.items.map((i) => [i.data.name, i.decision, i.sourceRef])).toEqual([
      ['Ankara Dress', 'approved', 'Rows 2–3'],
      ['Cap', 'approved', 'Row 4'],
      ['Broken', 'skipped', 'Row 5'],
    ]);
    expect(await listImports(actor)).toEqual([expect.objectContaining({ id: started.id })]);
  });

  it('refuses unreadable files with a plain message', async () => {
    const { actor } = await newBusiness('imp');
    await expect(startCsvImport(actor, { text: 'colour\nRed\n' })).rejects.toThrow(
      '"name" and "price"',
    );
  });

  it('cannot tick products with errors, and needs at least one ticked', async () => {
    const { actor } = await newBusiness('imp');
    const started = await startCsvImport(actor, { text: CSV() });
    await setImportItemsDecision(actor, started.id, { approved: true });
    let view = await getImport(actor, started.id);
    expect(view.items.find((i) => i.data.name === 'Broken')?.decision).toBe('skipped');
    await setImportItemsDecision(actor, started.id, { approved: false });
    await expect(confirmImport(actor, started.id)).rejects.toThrow('Tick at least one product');
    const cap = view.items.find((i) => i.data.name === 'Cap')!;
    await setImportItemsDecision(actor, started.id, { itemIds: [cap.id], approved: true });
    await confirmImport(actor, started.id);
    view = await getImport(actor, started.id);
    expect(view.import).toMatchObject({ status: 'saving', totalItems: 1, skippedCount: 2 });
    expect(queued).toEqual([{ businessId: actor.businessId, importId: started.id }]);
    await expect(confirmImport(actor, started.id)).rejects.toThrow('already started');
    await expect(cancelImport(actor, started.id)).rejects.toThrow('already started');
  });

  it('saves products with options, prices, stock history and photos, then reports', async () => {
    const { actor } = await newBusiness('imp');
    const view = await runImport(actor, CSV(`${photoBase}/ok.png ${photoBase}/missing.png`));
    expect(view.import).toMatchObject({
      status: 'done',
      totalItems: 2,
      processedItems: 2,
      createdCount: 2,
      updatedCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
    const dressItem = view.items.find((i) => i.data.name === 'Ankara Dress')!;
    expect(dressItem).toMatchObject({
      result: 'created',
      resultMessage: '1 photo could not be downloaded.',
    });

    const dress = await getProduct(actor, dressItem.productId!);
    expect(dress.product).toMatchObject({
      source: 'csv',
      externalId: 'AD',
      category: 'Dresses',
      retailPrice: 2_500_000,
    });
    expect(dress.product.photos).toHaveLength(1);
    expect(dress.variants.map((v) => [v.size, v.stock, v.priceOverride])).toEqual([
      ['S', 5, null],
      ['M', 2, 2_700_000],
    ]);
    expect(await listStockMovements(actor, dress.variants[0]!.id)).toEqual([
      expect.objectContaining({ change: 5, reason: 'import' }),
    ]);
    const events = await listEvents(actor);
    expect(events[0]).toMatchObject({
      type: 'catalog.imported',
      payload: expect.objectContaining({ created: 2, updated: 0, failed: 0 }),
    });
  });

  it('importing again updates products by product code instead of duplicating them', async () => {
    const { actor } = await newBusiness('imp');
    const first = await runImport(actor, CSV());
    const capId = first.items.find((i) => i.data.name === 'Cap')!.productId!;
    await setProductActive(actor, capId, false); // the owner's choice is kept

    const second = await runImport(
      actor,
      [
        'name,price,size,colour,stock,product code',
        'Ankara Dress v2,26000,M,Red,7,AD',
        'Ankara Dress v2,26000,L,Red,1,AD',
        'Cap,3500,,,,CAP',
      ].join('\n'),
    );
    expect(second.import).toMatchObject({ createdCount: 0, updatedCount: 2 });
    const products = await listProducts(actor);
    expect(products).toHaveLength(2);

    const dress = await getProduct(actor, second.items[0]!.productId!);
    expect(dress.product).toMatchObject({ name: 'Ankara Dress v2', retailPrice: 2_600_000 });
    // S was removed from the file (archived), M kept with new stock, L added.
    expect(dress.variants.map((v) => [v.size, v.stock])).toEqual([
      ['M', 7],
      ['L', 1],
    ]);
    const history = await listStockMovements(actor, dress.variants[0]!.id);
    expect(history[0]).toMatchObject({ change: 5, stockAfter: 7, reason: 'import' });

    const cap = await getProduct(actor, capId);
    expect(cap.product).toMatchObject({ retailPrice: 350_000, isActive: false });
    // No stock in the file: the stock is left as it was.
    expect(cap.variants[0]!.stock).toBe(10);
  });

  it('records a failed product and carries on', async () => {
    const { actor } = await newBusiness('imp');
    await runImport(actor, 'name,price,sku,product code\nOne,1000,SAME,A\n');
    const view = await runImport(
      actor,
      'name,price,sku,product code\nTwo,1000,SAME,B\nThree,2000,,C\n',
    );
    expect(view.import).toMatchObject({ status: 'done', createdCount: 1, failedCount: 1 });
    expect(view.items[0]).toMatchObject({
      result: 'failed',
      resultMessage: 'This SKU is already used by another product.',
    });
  });

  it('only owners and staff import, and businesses never see each other’s imports', async () => {
    const one = await newBusiness('imp');
    const two = await newBusiness('imp');
    const rider = await addMember(one.actor, 'rider');
    await expect(startCsvImport(rider, { text: CSV() })).rejects.toThrow();
    const staff = await addMember(one.actor, 'staff');
    const started = await startCsvImport(staff, { text: CSV() });
    await expect(getImport(two.actor, started.id)).rejects.toThrow('no longer exists');
    expect(await processCatalogImport(two.business.id, started.id)).toBe('not_found');
    expect(await processCatalogImport(one.business.id, started.id)).toBe('not_saving');
  });
});

describe('setStoreChoice', () => {
  it('saves the website, adding https://, or switches back to our store', async () => {
    const { actor } = await newBusiness('imp');
    await setStoreChoice(actor, { choice: 'website', websiteUrl: 'adastyles.com' });
    expect(await getBusiness(actor)).toMatchObject({
      hasExternalWebsite: true,
      websiteUrl: 'https://adastyles.com',
    });
    await expect(
      setStoreChoice(actor, { choice: 'website', websiteUrl: 'nonsense' }),
    ).rejects.toThrow();
    await setStoreChoice(actor, { choice: 'store' });
    expect(await getBusiness(actor)).toMatchObject({ hasExternalWebsite: false });
    const staff = await addMember(actor, 'staff');
    await expect(setStoreChoice(staff, { choice: 'store' })).rejects.toThrow();
  });
});
