import { describe, expect, it } from 'vitest';
import { saveBrandKit } from '../src/brand-kit/brand-kit';
import {
  archiveProduct,
  createProduct,
  setProductActive,
  updateProduct,
} from '../src/catalog/products';
import {
  getStoreBySubdomain,
  getStoreHome,
  getStoreProduct,
  listStoreProducts,
  STORE_PAGE_SIZE,
} from '../src/storefront/store';
import { newBusiness, productDraft } from './helpers';

describe('getStoreBySubdomain', () => {
  it('finds the store with brand defaults and only public details', async () => {
    const { business } = await newBusiness('store');
    const store = await getStoreBySubdomain(business.subdomain.toUpperCase());
    expect(store).toEqual({
      businessId: business.id,
      name: business.name,
      subdomain: business.subdomain,
      whatsappNumber: '+2348012345678',
      brand: {
        logo: null,
        primaryColour: '#0f6b55',
        accentColour: '#f5a524',
        font: 'clean',
        description: '',
      },
    });
  });

  it('uses the saved brand kit', async () => {
    const { business, actor } = await newBusiness('store');
    await saveBrandKit(actor, {
      logo: null,
      primaryColour: '#112233',
      accentColour: '#445566',
      font: 'elegant',
      voice: 'friendly',
      description: 'Handmade Ankara',
    });
    const store = await getStoreBySubdomain(business.subdomain);
    expect(store?.brand).toEqual({
      logo: null,
      primaryColour: '#112233',
      accentColour: '#445566',
      font: 'elegant',
      description: 'Handmade Ankara',
    });
  });

  it('returns null for unknown or invalid addresses', async () => {
    expect(await getStoreBySubdomain('no-such-store-xyz')).toBeNull();
    expect(await getStoreBySubdomain("bad'; drop")).toBeNull();
    expect(await getStoreBySubdomain('')).toBeNull();
  });
});

describe('getStoreHome', () => {
  it('shows the newest products until some are featured, never hidden or archived ones', async () => {
    const { actor, business } = await newBusiness('store');
    const a = await createProduct(actor, productDraft({ name: 'Item A', category: 'Dresses' }));
    const b = await createProduct(actor, productDraft({ name: 'Item B', category: 'Dresses' }));
    const hidden = await createProduct(actor, productDraft({ name: 'Hidden', category: 'Bags' }));
    const gone = await createProduct(actor, productDraft({ name: 'Gone', category: 'Bags' }));
    await setProductActive(actor, hidden.product.id, false);
    await archiveProduct(actor, gone.product.id);
    await createProduct(
      actor,
      productDraft({ name: 'Item C', category: 'Shoes', options: { kind: 'simple', stock: 0 } }),
    );

    const home = await getStoreHome(business.id);
    expect(home.featuredIsPicked).toBe(false);
    expect(home.featured.map((x) => x.name)).toEqual(['Item C', 'Item B', 'Item A']);
    expect(home.featured[0]).toMatchObject({
      soldOut: true,
      price: 1_500_000,
      hasPriceRange: false,
    });
    expect(home.categories).toEqual([
      { name: 'Dresses', productCount: 2 },
      { name: 'Shoes', productCount: 1 },
    ]);
    expect(home.productCount).toBe(3);

    await updateProduct(
      actor,
      a.product.id,
      productDraft({ name: 'Item A', category: 'Dresses', isFeatured: true }),
    );
    const picked = await getStoreHome(business.id);
    expect(picked.featuredIsPicked).toBe(true);
    expect(picked.featured.map((x) => x.name)).toEqual(['Item A']);
    expect(b.product.isFeatured).toBe(false);
  });

  it("never shows another business's products", async () => {
    const one = await newBusiness('store');
    const two = await newBusiness('store');
    await createProduct(one.actor, productDraft({ name: 'Mine' }));
    const home = await getStoreHome(two.business.id);
    expect(home.featured).toEqual([]);
    expect(home.productCount).toBe(0);
  });
});

describe('listStoreProducts', () => {
  it('filters by category and pages', async () => {
    const { actor, business } = await newBusiness('store');
    for (let i = 0; i < STORE_PAGE_SIZE + 1; i++) {
      await createProduct(actor, productDraft({ name: `P${i}`, category: 'Dresses' }));
    }
    await createProduct(actor, productDraft({ name: 'Bag', category: 'Bags' }));

    const first = await listStoreProducts(business.id, { category: 'Dresses' });
    expect(first.products).toHaveLength(STORE_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    const second = await listStoreProducts(business.id, { category: 'Dresses', page: 2 });
    expect(second.products.map((x) => x.name)).toEqual(['P0']);
    expect(second.hasMore).toBe(false);

    const bags = await listStoreProducts(business.id, { category: 'Bags' });
    expect(bags.products.map((x) => x.name)).toEqual(['Bag']);
    const bad = await listStoreProducts(business.id, { page: 'abc' as unknown as number });
    expect(bad.page).toBe(1);
  });
});

describe('getStoreProduct', () => {
  it('returns options with their own prices and stock, without archived ones', async () => {
    const { actor, business } = await newBusiness('store');
    const { product, variants } = await createProduct(
      actor,
      productDraft({
        retailPrice: 2_000_000,
        lowStockThreshold: 2,
        wholesalePrice: 1_500_000,
        wholesaleMinQty: 6,
        options: {
          kind: 'variants',
          variants: [
            { size: 'S', colour: 'Red', stock: 10 },
            { size: 'M', colour: 'Red', stock: 1, priceOverride: 2_500_000 },
            { size: 'L', colour: 'Red', stock: 0 },
            { size: 'XL', colour: 'Red', stock: 4 },
          ],
        },
      }),
    );
    // Remove XL.
    await updateProduct(
      actor,
      product.id,
      productDraft({
        name: product.name,
        retailPrice: 2_000_000,
        lowStockThreshold: 2,
        wholesalePrice: 1_500_000,
        wholesaleMinQty: 6,
        options: {
          kind: 'variants',
          variants: variants.slice(0, 3).map((x) => ({
            id: x.id,
            size: x.size,
            colour: x.colour,
            stock: x.stock,
            priceOverride: x.priceOverride,
          })),
        },
      }),
    );

    const view = await getStoreProduct(business.id, product.id);
    expect(view).toMatchObject({
      id: product.id,
      hasOptions: true,
      price: 2_000_000,
      hasPriceRange: true,
      soldOut: false,
      wholesale: { price: 1_500_000, minQty: 6 },
    });
    expect(view?.variants.map((x) => [x.label, x.price, x.stock.label])).toEqual([
      ['S / Red', 2_000_000, 'In stock'],
      ['M / Red', 2_500_000, 'Only 1 left'],
      ['L / Red', 2_000_000, 'Sold out'],
    ]);
  });

  it('gives a simple product one option with no label', async () => {
    const { actor, business } = await newBusiness('store');
    const { product } = await createProduct(
      actor,
      productDraft({ options: { kind: 'simple', stock: 0 } }),
    );
    const view = await getStoreProduct(business.id, product.id);
    expect(view).toMatchObject({ hasOptions: false, soldOut: true, wholesale: null });
    expect(view?.variants).toEqual([
      expect.objectContaining({ label: '', stock: { state: 'sold_out', label: 'Sold out' } }),
    ]);
  });

  it("returns null for hidden, archived, unknown or another business's products", async () => {
    const one = await newBusiness('store');
    const two = await newBusiness('store');
    const hidden = await createProduct(one.actor, productDraft());
    await setProductActive(one.actor, hidden.product.id, false);
    const archived = await createProduct(one.actor, productDraft());
    await archiveProduct(one.actor, archived.product.id);
    const visible = await createProduct(one.actor, productDraft());

    expect(await getStoreProduct(one.business.id, hidden.product.id)).toBeNull();
    expect(await getStoreProduct(one.business.id, archived.product.id)).toBeNull();
    expect(await getStoreProduct(one.business.id, 'not-a-uuid')).toBeNull();
    expect(await getStoreProduct(two.business.id, visible.product.id)).toBeNull();
    expect(await getStoreProduct(one.business.id, visible.product.id)).not.toBeNull();
  });
});
