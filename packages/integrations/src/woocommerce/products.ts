import { isCoreError, safeFetch, type WooCredentials } from '@fulcra/core';
import type { ImportedProduct } from '@fulcra/core/rules';
import { z } from 'zod';
import {
  type FetchedCatalog,
  htmlToText,
  ImportFetchError,
  photoList,
  priceToKobo,
  splitOptions,
  UNTRACKED_STOCK_NOTE,
} from '../shared';

const PAGE_SIZE = 50;
const MAX_PRODUCTS = 2000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

type Shop = { shopUrl: string; credentials: WooCredentials };

/**
 * GET from the seller's WooCommerce REST API (read-only keys). Tries the Authorization
 * header first; some hosts strip it, so on 401 it retries with the keys in the query
 * string (WooCommerce supports both over https).
 */
async function wooGet(shop: Shop, path: string, env?: NodeJS.ProcessEnv) {
  const base = `${shop.shopUrl}/wp-json/wc/v3${path}`;
  const basic = Buffer.from(
    `${shop.credentials.consumerKey}:${shop.credentials.consumerSecret}`,
  ).toString('base64');
  const attempt = (url: string, headers?: Record<string, string>) =>
    safeFetch(url, {
      maxBytes: MAX_JSON_BYTES,
      timeoutMs: 30_000,
      accept: 'application/json',
      allowErrorStatus: true,
      ...(headers ? { headers } : {}),
      ...(env ? { env } : {}),
    });
  let result;
  try {
    result = await attempt(base, { authorization: `Basic ${basic}` });
    if (result.status === 401) {
      const url = new URL(base);
      url.searchParams.set('consumer_key', shop.credentials.consumerKey);
      url.searchParams.set('consumer_secret', shop.credentials.consumerSecret);
      result = await attempt(url.toString());
    }
  } catch (error) {
    if (isCoreError(error))
      throw new ImportFetchError(`We could not reach your website: ${error.message}`);
    throw error;
  }
  if (result.status === 401 || result.status === 403) {
    throw new ImportFetchError(
      'Your WooCommerce keys were not accepted. Check them, or create new read keys.',
    );
  }
  if (result.status === 404) {
    throw new ImportFetchError(
      'We could not find WooCommerce on this website. Check the address, and that WooCommerce is installed.',
    );
  }
  if (result.status >= 400) {
    throw new ImportFetchError(
      `Your website returned an error (${result.status}). Please try again later.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(result.body));
  } catch {
    throw new ImportFetchError(
      'Your website did not answer like a WooCommerce shop. Check the address.',
    );
  }
  return { json, headers: result.headers };
}

/** Checks the keys work and returns the shop's currency (e.g. "NGN"). */
export async function verifyWooConnection(
  shop: Shop,
  env?: NodeJS.ProcessEnv,
): Promise<{ currency: string }> {
  const { json } = await wooGet(shop, '/data/currencies/current', env);
  const parsed = z.object({ code: z.string() }).safeParse(json);
  if (!parsed.success)
    throw new ImportFetchError('Your website did not answer like a WooCommerce shop.');
  return { currency: parsed.data.code };
}

const attributeSchema = z.object({ name: z.string(), option: z.string() });
const imageSchema = z.object({ src: z.string() });

const productSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  status: z.string().optional(),
  description: z.string().nullish(),
  short_description: z.string().nullish(),
  sku: z.string().nullish(),
  price: z.union([z.string(), z.number()]).nullish(),
  manage_stock: z.union([z.boolean(), z.string()]).nullish(),
  stock_quantity: z.number().nullish(),
  categories: z.array(z.object({ name: z.string() })).default([]),
  images: z.array(imageSchema).default([]),
});

const variationSchema = z.object({
  id: z.number(),
  sku: z.string().nullish(),
  price: z.union([z.string(), z.number()]).nullish(),
  manage_stock: z.union([z.boolean(), z.string()]).nullish(),
  stock_quantity: z.number().nullish(),
  attributes: z.array(attributeSchema).default([]),
  image: imageSchema.nullish(),
});

type WooProduct = z.infer<typeof productSchema>;
type WooVariation = z.infer<typeof variationSchema>;

const managed = (v: boolean | string | null | undefined) => v === true;

/** One WooCommerce product (and its variations) as ours. */
export function mapWooProduct(
  p: WooProduct,
  variations: WooVariation[],
): { product: ImportedProduct; untracked: boolean } {
  let untracked = false;
  const category = p.categories.find((c) => c.name.toLowerCase() !== 'uncategorized')?.name ?? null;
  const description = htmlToText(p.description) || htmlToText(p.short_description);
  const photos = photoList([...p.images.map((i) => i.src), ...variations.map((v) => v.image?.src)]);

  if (p.type === 'variable' && variations.length > 0) {
    const prices = variations.map((v) => priceToKobo(v.price));
    const valid = prices.filter((x): x is number => x !== null);
    const retailPrice = valid.length > 0 ? Math.min(...valid) : 0;
    const variants = variations.map((v, i) => {
      // A variation can leave stock to the parent product ("parent").
      const tracks =
        managed(v.manage_stock) || (v.manage_stock === 'parent' && managed(p.manage_stock));
      const quantity = managed(v.manage_stock) ? v.stock_quantity : p.stock_quantity;
      if (!tracks) untracked = true;
      const { size, colour } = splitOptions(
        v.attributes.map((a) => ({ name: a.name, value: a.option })),
      );
      const price = prices[i] ?? null;
      return {
        externalId: String(v.id),
        size,
        colour,
        sku: v.sku?.trim() || null,
        stock: tracks ? Math.max(0, quantity ?? 0) : null,
        priceOverride: price !== null && price !== retailPrice ? price : null,
      };
    });
    return {
      product: {
        externalId: String(p.id),
        name: p.name.trim().slice(0, 120),
        description,
        category,
        retailPrice,
        wholesalePrice: null,
        wholesaleMinQty: null,
        photoUrls: photos,
        variants,
      },
      untracked,
    };
  }

  const tracks = managed(p.manage_stock);
  return {
    product: {
      externalId: String(p.id),
      name: p.name.trim().slice(0, 120),
      description,
      category,
      retailPrice: priceToKobo(p.price) ?? 0,
      wholesalePrice: null,
      wholesaleMinQty: null,
      photoUrls: photos,
      variants: [
        {
          externalId: String(p.id),
          size: null,
          colour: null,
          sku: p.sku?.trim() || null,
          stock: tracks ? Math.max(0, p.stock_quantity ?? 0) : null,
          priceOverride: null,
        },
      ],
    },
    untracked: !tracks,
  };
}

/** Reads every published simple and variable product of a WooCommerce shop. */
export async function fetchWooCatalog(
  shop: Shop,
  env?: NodeJS.ProcessEnv,
): Promise<FetchedCatalog> {
  const { currency } = await verifyWooConnection(shop, env);
  if (currency !== 'NGN') {
    throw new ImportFetchError(
      `Your WooCommerce shop sells in ${currency}. Fulcra works in Naira (NGN) only for now.`,
    );
  }
  const catalog: FetchedCatalog = { products: [], notes: [] };
  for (let page = 1; ; page++) {
    const { json, headers } = await wooGet(
      shop,
      `/products?per_page=${PAGE_SIZE}&page=${page}&status=publish`,
      env,
    );
    const list = z.array(z.unknown()).safeParse(json);
    if (!list.success)
      throw new ImportFetchError('Your website sent a product list we could not read.');
    for (const raw of list.data) {
      const parsed = productSchema.safeParse(raw);
      // Grouped and external (affiliate) products are not sold by the shop itself.
      if (!parsed.success || (parsed.data.type !== 'simple' && parsed.data.type !== 'variable'))
        continue;
      let variations: WooVariation[] = [];
      if (parsed.data.type === 'variable') {
        const { json: vjson } = await wooGet(
          shop,
          `/products/${parsed.data.id}/variations?per_page=100`,
          env,
        );
        variations = z.array(variationSchema).catch([]).parse(vjson);
      }
      const { product, untracked } = mapWooProduct(parsed.data, variations);
      if (untracked)
        catalog.notes.push({ position: catalog.products.length, message: UNTRACKED_STOCK_NOTE });
      catalog.products.push(product);
    }
    const totalPages = Number(headers.get('x-wp-totalpages') ?? 0);
    const more = totalPages ? page < totalPages : list.data.length === PAGE_SIZE;
    if (!more || catalog.products.length >= MAX_PRODUCTS) break;
  }
  return catalog;
}
