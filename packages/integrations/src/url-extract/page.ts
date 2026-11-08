import { isCoreError, safeFetch } from '@fulcra/core';
import { ImportFetchError } from '../shared';

const MAX_PAGE_BYTES = 3 * 1024 * 1024;

export type FetchedPage = { url: string; html: string };

/** Downloads one web page of the seller's site (public addresses only, size and time limits). */
export async function fetchPage(url: string, env?: NodeJS.ProcessEnv): Promise<FetchedPage> {
  try {
    const result = await safeFetch(url, {
      maxBytes: MAX_PAGE_BYTES,
      timeoutMs: 20_000,
      accept: 'text/html,application/xhtml+xml',
      ...(env ? { env } : {}),
    });
    if (result.contentType && !/html|xml/i.test(result.contentType)) {
      throw new ImportFetchError('This link is not a web page. Use the address of your shop page.');
    }
    return { url: result.url, html: new TextDecoder().decode(result.body) };
  } catch (error) {
    if (isCoreError(error))
      throw new ImportFetchError(`We could not open your website: ${error.message}`);
    throw error;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, code: string) => {
    if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (/^#\d+$/.test(code)) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined);

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(decodeEntities(href.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.split('#')[0]! : null;
  } catch {
    return null;
  }
}

/**
 * Readable text of a page for the AI: scripts, styles and menus removed, images kept as
 * "[image: alt | url]" so photos can be matched to products. Capped in length.
 */
export function pageText(page: FetchedPage, maxChars = 20_000): string {
  let html = page.html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, ' ');
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = absolute(attr(tag, 'data-src') ?? attr(tag, 'src'), page.url);
    if (!src || src.startsWith('data:')) return ' ';
    return ` [image: ${decodeEntities(attr(tag, 'alt') ?? '').trim()} | ${src}] `;
  });
  const text = decodeEntities(
    html
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.slice(0, maxChars);
}

/** Same-site links, product-like ones first ("/product/…", "/shop/…"). */
export function productLinks(page: FetchedPage, limit: number): string[] {
  const origin = new URL(page.url).origin;
  const seen = new Set<string>([page.url]);
  const productish: string[] = [];
  const other: string[] = [];
  for (const match of page.html.matchAll(/<a\b[^>]*>/gi)) {
    const href = absolute(attr(match[0], 'href'), page.url);
    if (!href || new URL(href).origin !== origin || seen.has(href)) continue;
    seen.add(href);
    const path = new URL(href).pathname.toLowerCase();
    if (
      /\.(jpe?g|png|webp|gif|pdf|zip|css|js)$/.test(path) ||
      /(cart|checkout|login|account|wp-admin|contact|about|blog|privacy|terms)/.test(path)
    )
      continue;
    (/\/(products?|items?|p|shop|store|collections?)\/[^/]+/.test(path) ? productish : other).push(
      href,
    );
  }
  return productish.slice(0, limit);
}

/** schema.org Product data that many shops embed (JSON-LD). */
export type JsonLdProduct = {
  name: string;
  description: string;
  images: string[];
  price: number | null;
  currency: string | null;
  sku: string | null;
  category: string | null;
  url: string;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

export function jsonLdProducts(page: FetchedPage): JsonLdProduct[] {
  const found: JsonLdProduct[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    const types = asArray(obj['@type'] as string | string[]);
    if (types.includes('Product') && typeof obj.name === 'string') {
      const offers = asArray(
        obj.offers as Record<string, unknown> | Record<string, unknown>[],
      ).flatMap((o) =>
        o && typeof o === 'object' && 'offers' in o
          ? asArray(o.offers as Record<string, unknown>[])
          : [o],
      );
      const prices = offers
        .map((o) => Number(o?.price ?? o?.lowPrice))
        .filter((p) => Number.isFinite(p) && p > 0);
      const images = asArray(obj.image as unknown)
        .map((i) => (typeof i === 'string' ? i : (i as { url?: string })?.url))
        .map((i) => absolute(i, page.url))
        .filter((i): i is string => Boolean(i));
      found.push({
        name: obj.name.trim(),
        description:
          typeof obj.description === 'string' ? decodeEntities(obj.description).trim() : '',
        images,
        price: prices.length > 0 ? Math.min(...prices) : null,
        currency:
          (offers.find((o) => typeof o?.priceCurrency === 'string')?.priceCurrency as string) ??
          null,
        sku: typeof obj.sku === 'string' ? obj.sku : null,
        category: typeof obj.category === 'string' ? obj.category : null,
        url: absolute(typeof obj.url === 'string' ? obj.url : undefined, page.url) ?? page.url,
      });
    }
    for (const value of Object.values(obj)) if (value && typeof value === 'object') visit(value);
  };
  for (const match of page.html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(match[1]!.trim()));
    } catch {
      // Broken JSON-LD on the seller's site: the AI reads the page instead.
    }
  }
  return found;
}
