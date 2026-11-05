import { describe, expect, it } from 'vitest';
import { getDb, schema } from '@fulcra/db';
import { getBrandKit, saveBrandKit } from '../src/brand-kit/brand-kit';
import {
  archiveProduct,
  createProduct,
  duplicateProduct,
  getProduct,
  listProducts,
  setProductActive,
  updateProduct,
} from '../src/catalog/products';
import { adjustStock, listLowStock, listStockMovements } from '../src/catalog/stock';
import { newBusiness, productDraft } from './helpers';
import { eq } from 'drizzle-orm';

describe('catalog isolation between two businesses', () => {
  it('A cannot see or change B’s products, even with their ids', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const { product, variants } = await createProduct(
      b.actor,
      productDraft({ options: { kind: 'simple', stock: 1 } }),
    );

    expect(await listProducts(a.actor)).toEqual([]);
    expect(await listLowStock(a.actor)).toEqual([]);
    await expect(getProduct(a.actor, product.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateProduct(a.actor, product.id, productDraft())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(setProductActive(a.actor, product.id, false)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(duplicateProduct(a.actor, product.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      adjustStock(a.actor, { variantId: variants[0]!.id, change: -1 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await listStockMovements(a.actor, variants[0]!.id)).toEqual([]);
    await archiveProduct(a.actor, product.id);

    const still = await getProduct(b.actor, product.id);
    expect(still.product).toMatchObject({ isActive: true, archivedAt: null });
    expect(still.variants[0]!.stock).toBe(1);
  });

  it('a member of A cannot act on B by passing B’s business id', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const intruder = { businessId: b.business.id, userId: a.owner.userId };
    await expect(listProducts(intruder)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createProduct(intruder, productDraft())).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(getBrandKit(intruder)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the database refuses a variant pointing at another business’s product', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const { product } = await createProduct(b.actor, productDraft());
    await expect(
      getDb()
        .insert(schema.productVariants)
        .values({ businessId: a.business.id, productId: product.id, stock: 1 }),
    ).rejects.toThrow();
  });
});

describe('brand kit', () => {
  it('returns defaults, then saves; only the owner can save', async () => {
    const { actor, business } = await newBusiness();
    expect(await getBrandKit(actor)).toMatchObject({
      isSaved: false,
      primaryColour: '#0f6b55',
      voice: 'friendly',
    });

    const saved = await saveBrandKit(actor, {
      logo: null,
      primaryColour: '#AA3366',
      accentColour: '#ffcc00',
      font: 'elegant',
      voice: 'playful',
      voiceNotes: 'Use light Pidgin. Always greet with "Hello dear".',
      description: 'Handmade Ankara dresses from Lagos.',
    });
    expect(saved).toMatchObject({ isSaved: true, primaryColour: '#aa3366', font: 'elegant' });
    expect(await getBrandKit(actor)).toMatchObject({
      description: 'Handmade Ankara dresses from Lagos.',
    });

    const again = await saveBrandKit(actor, { ...saved, voice: 'professional' });
    expect(again.voice).toBe('professional');
    const rows = await getDb()
      .select()
      .from(schema.brandKits)
      .where(eq(schema.brandKits.businessId, business.id));
    expect(rows).toHaveLength(1);
  });

  it('rejects bad colours and a logo from another business; staff cannot save', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const base = {
      logo: null,
      primaryColour: '#112233',
      accentColour: '#445566',
      font: 'clean' as const,
      voice: 'friendly' as const,
    };
    await expect(saveBrandKit(a.actor, { ...base, primaryColour: 'red' })).rejects.toThrow();
    await expect(
      saveBrandKit(a.actor, {
        ...base,
        logo: { path: `${b.business.id}/${crypto.randomUUID()}`, width: 10, height: 10 },
      }),
    ).rejects.toMatchObject({ code: 'validation', field: 'logo' });

    const { addMember } = await import('./helpers');
    const staff = await addMember(a.actor, 'staff');
    await expect(saveBrandKit(staff, base)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
