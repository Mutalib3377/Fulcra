import { describe, expect, it } from 'vitest';
import {
  archiveProduct,
  createProduct,
  duplicateProduct,
  getProduct,
  listCategories,
  listProducts,
  setProductActive,
  updateProduct,
} from '../src/catalog/products';
import { adjustStock, listLowStock, listStockMovements } from '../src/catalog/stock';
import { addMember, newBusiness, productDraft, uniq } from './helpers';

describe('createProduct', () => {
  it('creates a simple product with one hidden default option and opening stock', async () => {
    const { actor } = await newBusiness();
    const { product, variants } = await createProduct(
      actor,
      productDraft({ category: ' Dresses ' }),
    );
    expect(product.category).toBe('Dresses');
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({ isDefault: true, stock: 5, size: null, colour: null });

    const history = await listStockMovements(actor, variants[0]!.id);
    expect(history).toEqual([
      expect.objectContaining({ change: 5, stockAfter: 5, reason: 'initial' }),
    ]);
  });

  it('creates size × colour options in order', async () => {
    const { actor } = await newBusiness();
    const { variants } = await createProduct(
      actor,
      productDraft({
        options: {
          kind: 'variants',
          variants: [
            { size: 'S', colour: 'Red', stock: 2, sku: 'AD-S-R' },
            { size: 'M', colour: 'Red', stock: 0, priceOverride: 1_600_000 },
          ],
        },
      }),
    );
    expect(variants.map((v) => [v.size, v.colour, v.stock, v.isDefault])).toEqual([
      ['S', 'Red', 2, false],
      ['M', 'Red', 0, false],
    ]);
    expect(variants[1]!.priceOverride).toBe(1_600_000);
  });

  it.each([
    [{ retailPrice: 0 }, 'retailPrice'],
    [{ wholesalePrice: 1_000_000 }, 'wholesaleMinQty'],
    [{ wholesalePrice: 2_000_000, wholesaleMinQty: 6 }, 'wholesalePrice'],
    [{ minPrice: 2_000_000 }, 'minPrice'],
    [{ options: { kind: 'variants', variants: [{ stock: 1 }] } }, 'options'],
    [
      {
        options: {
          kind: 'variants',
          variants: [
            { size: 'M', stock: 1 },
            { size: 'm', stock: 2 },
          ],
        },
      },
      'options',
    ],
  ])('rejects invalid input %#', async (overrides, field) => {
    const { actor } = await newBusiness();
    await expect(createProduct(actor, productDraft(overrides))).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.arrayContaining([field]) }),
      ]),
    });
  });

  it('refuses photos that belong to another business', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const foreign = { path: `${b.business.id}/${crypto.randomUUID()}`, width: 100, height: 100 };
    await expect(createProduct(a.actor, productDraft({ photos: [foreign] }))).rejects.toMatchObject(
      {
        code: 'validation',
        field: 'photos',
      },
    );
  });

  it('refuses a SKU already used by another product', async () => {
    const { actor } = await newBusiness();
    const sku = `SKU-${uniq()}`;
    await createProduct(actor, productDraft({ options: { kind: 'simple', stock: 1, sku } }));
    await expect(
      createProduct(
        actor,
        productDraft({ options: { kind: 'simple', stock: 1, sku: sku.toLowerCase() } }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', field: 'sku' });
  });
});

describe('updateProduct', () => {
  it('updates kept options, records stock changes, archives removed and adds new ones', async () => {
    const { actor } = await newBusiness();
    const created = await createProduct(
      actor,
      productDraft({
        options: {
          kind: 'variants',
          variants: [
            { size: 'S', stock: 4 },
            { size: 'M', stock: 4 },
          ],
        },
      }),
    );
    const [s, m] = created.variants;

    const updated = await updateProduct(actor, created.product.id, {
      ...productDraft({ name: 'Renamed dress', retailPrice: 1_800_000 }),
      options: {
        kind: 'variants',
        variants: [
          { id: s!.id, size: 'S', stock: 1 },
          { size: 'L', stock: 3 },
        ],
      },
    });

    expect(updated.product).toMatchObject({ name: 'Renamed dress', retailPrice: 1_800_000 });
    expect(updated.variants.map((v) => [v.size, v.stock])).toEqual([
      ['S', 1],
      ['L', 3],
    ]);
    expect(updated.variants[0]!.id).toBe(s!.id);
    expect(updated.variants.some((v) => v.id === m!.id)).toBe(false);

    const history = await listStockMovements(actor, s!.id);
    expect(history[0]).toMatchObject({ change: -3, stockAfter: 1, reason: 'adjustment' });
  });

  it('switching between simple and options keeps things consistent', async () => {
    const { actor } = await newBusiness();
    const simple = await createProduct(actor, productDraft());
    const withOptions = await updateProduct(
      actor,
      simple.product.id,
      productDraft({
        options: { kind: 'variants', variants: [{ colour: 'Blue', stock: 2 }] },
      }),
    );
    expect(withOptions.variants).toHaveLength(1);
    expect(withOptions.variants[0]).toMatchObject({ colour: 'Blue', isDefault: false });

    const backToSimple = await updateProduct(
      actor,
      simple.product.id,
      productDraft({ options: { kind: 'simple', stock: 7 } }),
    );
    expect(backToSimple.variants).toEqual([expect.objectContaining({ isDefault: true, stock: 7 })]);
  });

  it('a simple product keeps its default option when stock is edited', async () => {
    const { actor } = await newBusiness();
    const created = await createProduct(actor, productDraft());
    const updated = await updateProduct(
      actor,
      created.product.id,
      productDraft({ options: { kind: 'simple', stock: 9 } }),
    );
    expect(updated.variants[0]!.id).toBe(created.variants[0]!.id);
    expect(updated.variants[0]!.stock).toBe(9);
  });
});

describe('stock', () => {
  it('adds and removes stock, never below zero', async () => {
    const { actor } = await newBusiness();
    const { variants } = await createProduct(
      actor,
      productDraft({ options: { kind: 'simple', stock: 2 } }),
    );
    const variantId = variants[0]!.id;

    expect(await adjustStock(actor, { variantId, change: 10, note: 'New delivery' })).toEqual({
      stock: 12,
    });
    expect(await adjustStock(actor, { variantId, change: -12 })).toEqual({ stock: 0 });
    await expect(adjustStock(actor, { variantId, change: -1 })).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(adjustStock(actor, { variantId, change: 0 })).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('two people removing the last item at once cannot both succeed', async () => {
    const { actor } = await newBusiness();
    const { variants } = await createProduct(
      actor,
      productDraft({ options: { kind: 'simple', stock: 1 } }),
    );
    const variantId = variants[0]!.id;
    const results = await Promise.allSettled([
      adjustStock(actor, { variantId, change: -1 }),
      adjustStock(actor, { variantId, change: -1 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await getProduct(actor, (await listProducts(actor))[0]!.id)).variants[0]!.stock).toBe(
      0,
    );
  });

  it('lists low-stock options of active products only', async () => {
    const { actor } = await newBusiness();
    const low = await createProduct(
      actor,
      productDraft({ name: 'Low one', options: { kind: 'simple', stock: 2 } }),
    );
    await createProduct(
      actor,
      productDraft({ name: 'Plenty', options: { kind: 'simple', stock: 50 } }),
    );
    const hidden = await createProduct(
      actor,
      productDraft({ name: 'Hidden low', isActive: false, options: { kind: 'simple', stock: 0 } }),
    );

    const items = await listLowStock(actor);
    expect(items.map((i) => i.productName)).toEqual(['Low one']);
    expect(items[0]).toMatchObject({ productId: low.product.id, stock: 2, threshold: 3 });
    expect(items.some((i) => i.productId === hidden.product.id)).toBe(false);
  });
});

describe('listProducts and categories', () => {
  it('searches, filters and summarises stock; archived products disappear', async () => {
    const { actor } = await newBusiness();
    await createProduct(
      actor,
      productDraft({
        name: 'Red Ankara gown',
        category: 'Dresses',
        options: {
          kind: 'variants',
          variants: [
            { size: 'S', stock: 1 },
            { size: 'M', stock: 10 },
          ],
        },
      }),
    );
    await createProduct(
      actor,
      productDraft({
        name: 'Leather bag',
        category: 'Bags',
        options: { kind: 'simple', stock: 20 },
      }),
    );
    const hidden = await createProduct(
      actor,
      productDraft({ name: 'Old shoe 100%', category: 'Shoes', isActive: false }),
    );
    const gone = await createProduct(actor, productDraft({ name: 'Gone' }));
    await archiveProduct(actor, gone.product.id);

    const all = await listProducts(actor);
    expect(all.map((p) => p.name).sort()).toEqual([
      'Leather bag',
      'Old shoe 100%',
      'Red Ankara gown',
    ]);
    const gown = all.find((p) => p.name === 'Red Ankara gown')!;
    expect(gown).toMatchObject({
      totalStock: 11,
      optionCount: 2,
      hasOptions: true,
      lowStock: true,
    });
    expect(all.find((p) => p.name === 'Leather bag')).toMatchObject({
      hasOptions: false,
      lowStock: false,
    });

    expect((await listProducts(actor, { search: 'ankara' })).map((p) => p.name)).toEqual([
      'Red Ankara gown',
    ]);
    expect((await listProducts(actor, { search: '100%' })).map((p) => p.name)).toEqual([
      'Old shoe 100%',
    ]);
    expect((await listProducts(actor, { search: '%' })).map((p) => p.name)).toEqual([
      'Old shoe 100%',
    ]);
    expect((await listProducts(actor, { category: 'Bags' })).map((p) => p.name)).toEqual([
      'Leather bag',
    ]);
    expect((await listProducts(actor, { show: 'low_stock' })).map((p) => p.name)).toEqual([
      'Red Ankara gown',
    ]);
    expect((await listProducts(actor, { show: 'hidden' })).map((p) => p.id)).toEqual([
      hidden.product.id,
    ]);

    expect(await listCategories(actor)).toEqual(['Bags', 'Dresses', 'Shoes']);
    await expect(getProduct(actor, gone.product.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('hides and shows products', async () => {
    const { actor } = await newBusiness();
    const { product } = await createProduct(actor, productDraft());
    await setProductActive(actor, product.id, false);
    expect((await getProduct(actor, product.id)).product.isActive).toBe(false);
  });
});

describe('duplicateProduct', () => {
  it('copies details and options with zero stock and no SKUs', async () => {
    const { actor } = await newBusiness();
    const original = await createProduct(
      actor,
      productDraft({
        name: 'Gown',
        wholesalePrice: 1_200_000,
        wholesaleMinQty: 6,
        options: {
          kind: 'variants',
          variants: [
            { size: 'S', stock: 3, sku: `G-${uniq()}` },
            { size: 'M', stock: 3 },
          ],
        },
      }),
    );
    const copy = await duplicateProduct(actor, original.product.id);
    expect(copy.product).toMatchObject({
      name: 'Gown (copy)',
      wholesalePrice: 1_200_000,
      wholesaleMinQty: 6,
    });
    expect(copy.variants.map((v) => [v.size, v.stock, v.sku])).toEqual([
      ['S', 0, null],
      ['M', 0, null],
    ]);
  });
});

describe('permissions', () => {
  it('staff can edit the catalog, riders cannot', async () => {
    const { actor } = await newBusiness();
    const staff = await addMember(actor, 'staff');
    const rider = await addMember(actor, 'rider');

    const { product, variants } = await createProduct(staff, productDraft());
    await expect(createProduct(rider, productDraft())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      adjustStock(rider, { variantId: variants[0]!.id, change: 1 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(archiveProduct(rider, product.id)).rejects.toMatchObject({ code: 'forbidden' });
    // Riders can still see products (to deliver them).
    expect((await listProducts(rider)).map((p) => p.id)).toContain(product.id);
  });
});
