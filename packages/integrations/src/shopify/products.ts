import type { ShopifyCredentials } from '@fulcra/core';
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
import { shopBaseUrl } from './oauth';

/** Admin API version (Shopify releases one every quarter; each is supported for a year). */
export function shopifyApiVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHOPIFY_API_VERSION?.trim() || '2026-07';
}

/** Small pages keep each request under Shopify's query cost limit (8 products × 100 options). */
const PAGE_SIZE = 8;
const MAX_PRODUCTS = 2000;

const QUERY = `query Products($cursor: String) {
  shop { currencyCode }
  products(first: ${PAGE_SIZE}, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      title
      descriptionHtml
      productType
      media(first: 8) { nodes { ... on MediaImage { image { url } } } }
      variants(first: 100) {
        nodes {
          legacyResourceId
          sku
          price
          inventoryQuantity
          inventoryItem { tracked }
          selectedOptions { name value }
        }
      }
    }
  }
}`;

const variantSchema = z.object({
  legacyResourceId: z.string(),
  sku: z.string().nullish(),
  price: z.union([z.string(), z.number()]).nullish(),
  inventoryQuantity: z.number().nullish(),
  inventoryItem: z.object({ tracked: z.boolean().nullish() }).nullish(),
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
});

const productSchema = z.object({
  legacyResourceId: z.string(),
  title: z.string(),
  descriptionHtml: z.string().nullish(),
  productType: z.string().nullish(),
  media: z
    .object({
      nodes: z.array(z.object({ image: z.object({ url: z.string() }).nullish() }).passthrough()),
    })
    .nullish(),
  variants: z.object({ nodes: z.array(variantSchema) }),
});

const responseSchema = z.object({
  data: z
    .object({
      shop: z.object({ currencyCode: z.string() }),
      products: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
        nodes: z.array(productSchema),
      }),
    })
    .nullish(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.object({ code: z.string().optional() }).passthrough().optional(),
      }),
    )
    .optional(),
});

type ShopifyProduct = z.infer<typeof productSchema>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(
  shop: string,
  credentials: ShopifyCredentials,
  cursor: string | null,
  env: NodeJS.ProcessEnv,
): Promise<z.infer<typeof responseSchema>> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(
        `${shopBaseUrl(shop, env)}/admin/api/${shopifyApiVersion(env)}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-shopify-access-token': credentials.accessToken,
          },
          body: JSON.stringify({ query: QUERY, variables: { cursor } }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      if (attempt < 3) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new ImportFetchError('Shopify did not respond. Please try again later.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ImportFetchError('Shopify did not accept the connection. Connect your shop again.');
    }
    if (response.status === 402 || response.status === 423) {
      throw new ImportFetchError(
        'Your Shopify store is not active (closed or unpaid), so products cannot be read.',
      );
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt < 5) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new ImportFetchError('Shopify is busy. Please try again in a few minutes.');
    }
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new ImportFetchError('Shopify sent something we could not read. Please try again.');
    const throttled = parsed.data.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < 5) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!parsed.data.data) {
      console.error('[shopify] query errors', parsed.data.errors);
      throw new ImportFetchError('Shopify could not list your products. Please try again.');
    }
    return parsed.data;
  }
}

/** One Shopify product as ours. Prices: the lowest option price is the product price. */
export function mapShopifyProduct(p: ShopifyProduct): {
  product: ImportedProduct;
  untracked: boolean;
} {
  const isDefault =
    p.variants.nodes.length === 1 &&
    p.variants.nodes[0]!.selectedOptions.every(
      (o) => o.value === 'Default Title' || o.name === 'Title',
    );
  const prices = p.variants.nodes.map((v) => priceToKobo(v.price));
  const valid = prices.filter((x): x is number => x !== null);
  const retailPrice = valid.length > 0 ? Math.min(...valid) : 0;
  let untracked = false;
  const variants = p.variants.nodes.map((v, i) => {
    const tracked = v.inventoryItem?.tracked !== false;
    if (!tracked) untracked = true;
    const options = isDefault ? { size: null, colour: null } : splitOptions(v.selectedOptions);
    const price = prices[i] ?? null;
    return {
      externalId: v.legacyResourceId,
      size: options.size,
      colour: options.colour,
      sku: v.sku?.trim() || null,
      stock: tracked ? Math.max(0, v.inventoryQuantity ?? 0) : null,
      priceOverride: price !== null && price !== retailPrice ? price : null,
    };
  });
  return {
    product: {
      externalId: p.legacyResourceId,
      name: p.title.trim().slice(0, 120),
      description: htmlToText(p.descriptionHtml),
      category: p.productType?.trim().slice(0, 60) || null,
      retailPrice,
      wholesalePrice: null,
      wholesaleMinQty: null,
      photoUrls: photoList((p.media?.nodes ?? []).map((m) => m.image?.url)),
      variants,
    },
    untracked,
  };
}

/** Reads every active product of a Shopify store. */
export async function fetchShopifyCatalog(
  shop: string,
  credentials: ShopifyCredentials,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FetchedCatalog> {
  const catalog: FetchedCatalog = { products: [], notes: [] };
  let cursor: string | null = null;
  for (;;) {
    const page = await query(shop, credentials, cursor, env);
    const data = page.data!;
    if (data.shop.currencyCode !== 'NGN') {
      throw new ImportFetchError(
        `Your Shopify store sells in ${data.shop.currencyCode}. Fulcra works in Naira (NGN) only for now.`,
      );
    }
    for (const node of data.products.nodes) {
      const { product, untracked } = mapShopifyProduct(node);
      if (untracked)
        catalog.notes.push({ position: catalog.products.length, message: UNTRACKED_STOCK_NOTE });
      catalog.products.push(product);
    }
    if (!data.products.pageInfo.hasNextPage || catalog.products.length >= MAX_PRODUCTS) break;
    cursor = data.products.pageInfo.endCursor ?? null;
  }
  return catalog;
}
