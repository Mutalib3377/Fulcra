import type { schema } from '@fulcra/db';
import { parse } from 'csv-parse/sync';
import { MAX_PRODUCT_PHOTOS, nairaToKobo } from '../catalog/rules';
import { checkImportedProduct } from './check';

/** Files larger than this are refused (about 5,000 rows). */
export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

/** Columns of the template, in order. Only name and price are required. */
export const CSV_TEMPLATE_COLUMNS = [
  'name',
  'price',
  'description',
  'category',
  'size',
  'colour',
  'stock',
  'sku',
  'wholesale price',
  'wholesale from',
  'photos',
  'product code',
] as const;

type Column = (typeof CSV_TEMPLATE_COLUMNS)[number];

/** Other headings sellers (and other tools' exports) use for the same columns. */
const ALIASES: Record<string, Column> = {
  name: 'name',
  'product name': 'name',
  product: 'name',
  title: 'name',
  price: 'price',
  'retail price': 'price',
  'selling price': 'price',
  amount: 'price',
  description: 'description',
  details: 'description',
  category: 'category',
  type: 'category',
  size: 'size',
  colour: 'colour',
  color: 'colour',
  stock: 'stock',
  quantity: 'stock',
  qty: 'stock',
  'in stock': 'stock',
  sku: 'sku',
  'wholesale price': 'wholesale price',
  wholesale: 'wholesale price',
  'wholesale from': 'wholesale from',
  'wholesale min qty': 'wholesale from',
  'wholesale minimum': 'wholesale from',
  'minimum wholesale quantity': 'wholesale from',
  photos: 'photos',
  photo: 'photos',
  images: 'photos',
  image: 'photos',
  'photo links': 'photos',
  'image url': 'photos',
  'product code': 'product code',
  code: 'product code',
  id: 'product code',
  handle: 'product code',
};

export type ParsedImportItem = {
  position: number;
  /** "Row 4" or "Rows 4–6", for messages. */
  sourceRef: string;
  data: schema.ImportedProduct;
  problems: schema.ImportProblem[];
};

export type CsvParseResult =
  | { ok: true; items: ParsedImportItem[]; ignoredColumns: string[] }
  | { ok: false; message: string };

const normaliseHeading = (h: string) =>
  h
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s*\(.*\)\s*$/, '');

/** The template as a CSV file with two example products (one with sizes). */
export function csvTemplate(): string {
  const rows = [
    [...CSV_TEMPLATE_COLUMNS],
    [
      'Ankara Midi Dress',
      '25000',
      'Flowy midi dress, fully lined',
      'Dresses',
      'S',
      'Red',
      '5',
      'AMD-S-RED',
      '20000',
      '6',
      'https://example.com/dress-front.jpg https://example.com/dress-back.jpg',
      'AMD',
    ],
    ['Ankara Midi Dress', '25000', '', '', 'M', 'Red', '3', 'AMD-M-RED', '', '', '', 'AMD'],
    ['Ankara Midi Dress', '27000', '', '', 'L', 'Red', '0', 'AMD-L-RED', '', '', '', 'AMD'],
    [
      'Shea Butter Cream 250g',
      '4500',
      'Pure unrefined shea butter',
      'Skin care',
      '',
      '',
      '20',
      '',
      '',
      '',
      '',
      '',
    ],
  ];
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Comma, semicolon (Excel in some regions) or tab, whichever the heading row uses most. */
function detectDelimiter(text: string): string {
  const firstLine = (text.split(/\r?\n/, 1)[0] ?? '').replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

type Row = { line: number; values: Partial<Record<Column, string>> };

/**
 * Reads a product CSV. Rows with the same product code (or, without codes, the same name)
 * become one product; their size/colour rows become its options. Never throws for bad
 * content: problems are reported per product so the seller can fix or skip them.
 */
export function parseCatalogCsv(text: string): CsvParseResult {
  if (new TextEncoder().encode(text).byteLength > MAX_CSV_BYTES) {
    return { ok: false, message: 'This file is too large. Split it into files under 2 MB.' };
  }
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    return {
      ok: false,
      message: 'We could not read this file. Save it as CSV (comma separated) and try again.',
    };
  }
  const [header, ...body] = records;
  if (!header) return { ok: false, message: 'This file is empty.' };

  const columns = header.map((h) => ALIASES[normaliseHeading(h)] ?? null);
  const ignoredColumns = header.filter((h, i) => h.trim() && columns[i] === null);
  if (!columns.includes('name') || !columns.includes('price')) {
    return {
      ok: false,
      message:
        'The first row must have column names, including "name" and "price". Download our template to see the layout.',
    };
  }
  if (body.length === 0)
    return { ok: false, message: 'This file has no products under the headings.' };
  if (body.length > MAX_CSV_ROWS) {
    return {
      ok: false,
      message: `This file has more than ${MAX_CSV_ROWS} rows. Split it into smaller files.`,
    };
  }

  const rows: Row[] = body
    .map((cells, i) => {
      const values: Partial<Record<Column, string>> = {};
      columns.forEach((column, c) => {
        const value = cells[c]?.trim();
        if (column && value && !values[column]) values[column] = value;
      });
      return { line: i + 2, values };
    })
    .filter((row) => Object.keys(row.values).length > 0);

  // Group rows into products, keeping the order of first appearance.
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const code = row.values['product code'];
    const key = code
      ? `code:${code.toLowerCase()}`
      : row.values.name
        ? `name:${row.values.name.toLowerCase()}`
        : `row:${row.line}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const items = [...groups.values()].map((group, index) => buildItem(group, index));
  return { ok: true, items, ignoredColumns };
}

function rowsLabel(group: Row[]): string {
  const lines = group.map((r) => r.line);
  if (lines.length === 1) return `Row ${lines[0]}`;
  const sorted = [...lines].sort((a, b) => a - b);
  const contiguous = sorted.every((l, i) => i === 0 || l === sorted[i - 1]! + 1);
  return contiguous ? `Rows ${sorted[0]}–${sorted.at(-1)}` : `Rows ${sorted.join(', ')}`;
}

function wholeNumber(value: string | undefined): number | null | 'invalid' {
  if (value === undefined) return null;
  const clean = value.replace(/,/g, '');
  return /^\d+$/.test(clean) && Number(clean) <= 1_000_000 ? Number(clean) : 'invalid';
}

function buildItem(group: Row[], position: number): ParsedImportItem {
  const problems: schema.ImportProblem[] = [];
  const error = (message: string) => problems.push({ level: 'error', message });
  const warn = (message: string) => problems.push({ level: 'warning', message });
  const first = group[0]!;
  // Product-level details come from the first row that has them.
  const pick = (column: Column) => group.find((r) => r.values[column])?.values[column];

  const name = pick('name') ?? '';
  if (!name) error('The name is missing.');

  const priceText = first.values.price ?? pick('price');
  const retailPrice = priceText ? nairaToKobo(priceText) : null;
  if (!priceText) error('The price is missing.');
  else if (retailPrice === null)
    error(`"${priceText}" is not a price. Use numbers only, e.g. 15000.`);

  const wholesaleText = pick('wholesale price');
  const wholesaleFromText = pick('wholesale from');
  let wholesalePrice: number | null = null;
  let wholesaleMinQty: number | null = null;
  if (wholesaleText || wholesaleFromText) {
    const price = wholesaleText ? nairaToKobo(wholesaleText) : null;
    const from = wholeNumber(wholesaleFromText);
    if (price === null || from === null || from === 'invalid' || from < 2) {
      warn(
        'The wholesale price was left out: give both the wholesale price and "wholesale from" (2 or more).',
      );
    } else {
      wholesalePrice = price;
      wholesaleMinQty = from;
    }
  }

  const photoUrls: string[] = [];
  for (const raw of (pick('photos') ?? '').split(/[\s,|]+/).filter(Boolean)) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      if (!photoUrls.includes(url.href)) photoUrls.push(url.href);
    } catch {
      warn(`"${raw.slice(0, 60)}" is not a photo link, so it was left out.`);
    }
  }
  if (photoUrls.length > MAX_PRODUCT_PHOTOS) {
    warn(`Only the first ${MAX_PRODUCT_PHOTOS} photos will be used.`);
    photoUrls.length = MAX_PRODUCT_PHOTOS;
  }

  const hasOptions = group.some((r) => r.values.size || r.values.colour);
  if (hasOptions && group.some((r) => !r.values.size && !r.values.colour)) {
    error(
      'Some rows of this product have a size or colour and some do not. Give every row a size or colour.',
    );
  }
  if (!hasOptions && group.length > 1) {
    error(
      `This product is listed ${group.length} times. Add a size or colour to each row, or remove the extra rows.`,
    );
  }

  const variants: schema.ImportedVariant[] = group.map((row) => {
    const stock = wholeNumber(row.values.stock);
    if (stock === 'invalid') error(`Row ${row.line}: "${row.values.stock}" is not a stock number.`);
    const rowPrice = row.values.price ? nairaToKobo(row.values.price) : retailPrice;
    // The product's own price is already reported above; only report other rows' prices.
    if (row.values.price && rowPrice === null && row.values.price !== priceText) {
      error(`Row ${row.line}: "${row.values.price}" is not a price.`);
    }
    return {
      externalId: null,
      size: hasOptions ? (row.values.size ?? null) : null,
      colour: hasOptions ? (row.values.colour ?? null) : null,
      sku: row.values.sku ?? null,
      stock: stock === 'invalid' ? null : stock,
      priceOverride:
        rowPrice !== null && retailPrice !== null && rowPrice !== retailPrice ? rowPrice : null,
    };
  });
  if (variants.every((v) => v.stock === null)) {
    warn('No stock given, so it starts at 0. You can change it after importing.');
  }

  const data: schema.ImportedProduct = {
    externalId: first.values['product code'] ?? null,
    name,
    description: pick('description') ?? '',
    category: pick('category') ?? null,
    retailPrice: retailPrice ?? 0,
    wholesalePrice,
    wholesaleMinQty,
    photoUrls,
    variants,
  };
  if (!problems.some((p) => p.level === 'error')) problems.push(...checkImportedProduct(data));
  return { position, sourceRef: rowsLabel(group), data, problems };
}
