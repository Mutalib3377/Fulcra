import { describe, expect, it } from 'vitest';
import { csvTemplate, parseCatalogCsv } from './csv';

const ok = (text: string) => {
  const result = parseCatalogCsv(text);
  if (!result.ok) throw new Error(result.message);
  return result;
};

describe('parseCatalogCsv', () => {
  it('reads the template: one product with sizes and one simple product', () => {
    const { items, ignoredColumns } = ok(csvTemplate());
    expect(ignoredColumns).toEqual([]);
    expect(items).toHaveLength(2);
    const [dress, shea] = items;
    expect(dress!.sourceRef).toBe('Rows 2–4');
    expect(dress!.problems).toEqual([]);
    expect(dress!.data).toMatchObject({
      externalId: 'AMD',
      name: 'Ankara Midi Dress',
      category: 'Dresses',
      retailPrice: 2_500_000,
      wholesalePrice: 2_000_000,
      wholesaleMinQty: 6,
      photoUrls: ['https://example.com/dress-front.jpg', 'https://example.com/dress-back.jpg'],
    });
    expect(
      dress!.data.variants.map((v) => [v.size, v.colour, v.stock, v.sku, v.priceOverride]),
    ).toEqual([
      ['S', 'Red', 5, 'AMD-S-RED', null],
      ['M', 'Red', 3, 'AMD-M-RED', null],
      ['L', 'Red', 0, 'AMD-L-RED', 2_700_000],
    ]);
    expect(shea!.data).toMatchObject({
      name: 'Shea Butter Cream 250g',
      retailPrice: 450_000,
      externalId: null,
    });
    expect(shea!.data.variants).toEqual([
      { externalId: null, size: null, colour: null, sku: null, stock: 20, priceOverride: null },
    ]);
  });

  it('accepts other headings, semicolons, ₦ signs and a byte order mark', () => {
    const { items, ignoredColumns } = ok(
      '\uFEFFProduct Name;Selling Price;Qty;Color;Notes\nWrap;₦3,500;4;Blue;x\n',
    );
    expect(ignoredColumns).toEqual(['Notes']);
    expect(items[0]!.data).toMatchObject({ name: 'Wrap', retailPrice: 350_000 });
    expect(items[0]!.data.variants[0]).toMatchObject({ colour: 'Blue', stock: 4 });
  });

  it('groups rows by name when there is no product code', () => {
    const { items } = ok('name,price,size,stock\nTee,5000,S,1\nBag,9000,,2\ntee,5000,M,2\n');
    expect(items.map((i) => [i.data.name, i.data.variants.length, i.sourceRef])).toEqual([
      ['Tee', 2, 'Rows 2, 4'],
      ['Bag', 1, 'Row 3'],
    ]);
  });

  it('reports problems per product in plain words', () => {
    const { items } = ok(
      [
        'name,price,size,stock,photos,wholesale price',
        ',5000,,1,,',
        'No price,,,1,,',
        'Bad price,abc,,1,,',
        'Twice,1000,,1,,',
        'Twice,1000,,1,,',
        'Mixed,1000,S,1,,',
        'Mixed,1000,,1,,',
        'Bad stock,1000,,many,,',
        'Photo,1000,,1,not-a-link ftp://x.com/a.jpg,',
        'Wholesale,1000,,1,,800',
        'Dup size,1000,S,1,,',
        'Dup size,1000,S,2,,',
      ].join('\n'),
    );
    const byName = Object.fromEntries(items.map((i) => [i.data.name || i.sourceRef, i.problems]));
    expect(byName['Row 2']).toContainEqual({ level: 'error', message: 'The name is missing.' });
    expect(byName['No price']).toContainEqual({ level: 'error', message: 'The price is missing.' });
    expect(byName['Bad price']!.map((p) => p.message)).toEqual([
      '"abc" is not a price. Use numbers only, e.g. 15000.',
    ]);
    expect(byName['Twice']![0]!.message).toContain('listed 2 times');
    expect(byName['Mixed']![0]!.message).toContain('Some rows of this product have a size');
    expect(byName['Bad stock']![0]!.message).toContain('"many" is not a stock number');
    expect(byName['Photo']!.map((p) => p.level)).toEqual(['warning', 'warning']);
    expect(byName['Wholesale']).toEqual([
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('wholesale price was left out'),
      }),
    ]);
    expect(byName['Dup size']).toContainEqual({
      level: 'error',
      message: 'This size and colour is listed twice.',
    });
  });

  it('refuses files without the required headings or rows', () => {
    expect(parseCatalogCsv('')).toMatchObject({ ok: false });
    expect(parseCatalogCsv('title,colour\nA,Red\n')).toMatchObject({
      ok: false,
      message: expect.stringContaining('"name" and "price"'),
    });
    expect(parseCatalogCsv('name,price\n')).toMatchObject({
      ok: false,
      message: expect.stringContaining('no products'),
    });
  });

  it('warns when no stock is given', () => {
    const { items } = ok('name,price\nCap,2000\n');
    expect(items[0]!.problems).toEqual([
      {
        level: 'warning',
        message: 'No stock given, so it starts at 0. You can change it after importing.',
      },
    ]);
  });
});
