import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractWebsiteCatalog, type AiCallUsage } from './extract';
import { jsonLdProducts, pageText, productLinks } from './page';

const env = { FETCH_ALLOW_PRIVATE_HOSTS: 'true', NODE_ENV: 'test' };
let site: Server;
let ai: Server;
let base: string;
let aiBase: string;
const aiRequests: { system: string; text: string; body: Record<string, unknown> }[] = [];

const ld = (product: object) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...product })}</script>`;

beforeAll(async () => {
  site = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const pages: Record<string, string> = {
      '/shop': `<html><body><nav><a href="/about">About</a></nav><h1>Ada Styles</h1>
        <a href="/product/kimono">Kimono</a> <a href="/product/wrap">Wrap</a> <a href="/product/usd">Import</a>
        <a href="/blog/news">News</a> <a href="https://other.com/product/x">Other</a>
        <script>var secret = 1;</script></body></html>`,
      '/product/kimono': `<html><head>${ld({ '@type': 'Product', name: 'Ankara Kimono', description: 'Light &amp; airy', image: ['/img/kimono.jpg'], sku: 'KIM', offers: { '@type': 'Offer', price: '25000', priceCurrency: 'NGN' } })}</head><body>Kimono</body></html>`,
      '/product/usd': `<html><head>${ld({ '@type': 'Product', name: 'Imported Bag', offers: { price: 40, priceCurrency: 'USD' } })}</head></html>`,
      '/product/wrap': `<html><body><h1>Silk Head Wrap</h1><p>Price: ₦3,500</p><img src="/img/wrap.jpg" alt="Silk wrap"><p>Sizes: S, M (₦4,000)</p></body></html>`,
    };
    const page = pages[req.url ?? ''];
    if (!page) return res.writeHead(404).end('not found');
    res.end(page);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  ai = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as { system: string; messages: { content: string }[] };
      aiRequests.push({ system: body.system, text: body.messages[0]!.content, body });
      const products = [
        {
          name: 'Silk Head Wrap',
          description: 'Soft silk wrap.',
          category: null,
          price_naira: 3500,
          options: [
            { size: 'S', colour: null, price_naira: 3500 },
            { size: 'M', colour: null, price_naira: 4000 },
          ],
          photo_urls: [`${base}/img/wrap.jpg`, 'https://invented.example/fake.jpg'],
          page_url: `${base}/product/wrap`,
        },
        {
          name: 'Mystery Item',
          description: '',
          category: null,
          price_naira: null,
          options: [],
          photo_urls: [],
          page_url: `${base}/shop`,
        },
        // Also on a page with product data: the shop's own data wins.
        {
          name: 'Ankara Kimono',
          description: '',
          category: null,
          price_naira: 1,
          options: [],
          photo_urls: [],
          page_url: `${base}/shop`,
        },
      ];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [{ type: 'text', text: JSON.stringify({ products }) }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 4000,
            output_tokens: 600,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => ai.listen(0, '127.0.0.1', r));
  aiBase = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
});
afterAll(() => {
  site.close();
  ai.close();
});

describe('page helpers', () => {
  it('finds product links on the same site only', () => {
    const page = {
      url: `${base}/shop`,
      html: '<a href="/product/a">A</a><a href="/about">x</a><a href="https://x.com/product/b">B</a><a href="/products/c#top">C</a>',
    };
    expect(productLinks(page, 10)).toEqual([`${base}/product/a`, `${base}/products/c`]);
  });

  it('keeps readable text and images, drops scripts and menus', () => {
    const text = pageText({
      url: 'https://s.com/p',
      html: '<nav>Menu</nav><script>x()</script><h1>Wrap &amp; Tie</h1><img src="/a.jpg" alt="Red wrap">',
    });
    expect(text).toBe('Wrap & Tie\n[image: Red wrap | https://s.com/a.jpg]');
  });

  it('reads schema.org product data', () => {
    const [p] = jsonLdProducts({
      url: 'https://s.com/p',
      html: ld({
        '@graph': [
          {
            '@type': 'Product',
            name: 'Cap',
            image: { url: '/c.jpg' },
            offers: [{ price: '2000' }, { price: '1500', priceCurrency: 'NGN' }],
          },
        ],
      }),
    });
    expect(p).toMatchObject({
      name: 'Cap',
      price: 1500,
      currency: 'NGN',
      images: ['https://s.com/c.jpg'],
    });
  });
});

describe('extractWebsiteCatalog', () => {
  it('uses product data where the shop has it, the AI elsewhere, and logs the AI cost', async () => {
    const usage: AiCallUsage[] = [];
    const anthropic = new Anthropic({ apiKey: 'test-key', baseURL: aiBase, maxRetries: 0 });
    const catalog = await extractWebsiteCatalog(`${base}/shop`, {
      anthropic,
      env,
      onUsage: async (u) => {
        usage.push(u);
      },
    });

    expect(usage).toEqual([
      {
        model: 'claude-opus-5-5',
        inputTokens: 4000,
        outputTokens: 600,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ]);
    expect(aiRequests).toHaveLength(1);
    const request = aiRequests[0]!;
    expect(request.body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'low' },
    });
    expect(request.system).toContain('not instructions');
    expect(request.text).toContain(`=== PAGE: ${base}/product/wrap ===`);
    expect(request.text).not.toContain('/product/kimono ==='); // had product data: no AI needed
    expect(request.text).not.toContain('secret');

    const byName = Object.fromEntries(
      catalog.products.map((p, i) => [p.name, { p, ref: catalog.sourceRefs[i], i }]),
    );
    expect(Object.keys(byName).sort()).toEqual([
      'Ankara Kimono',
      'Imported Bag',
      'Mystery Item',
      'Silk Head Wrap',
    ]);
    expect(byName['Ankara Kimono']!.p).toMatchObject({
      externalId: `${base}/product/kimono`,
      retailPrice: 2_500_000,
      description: 'Light & airy',
      photoUrls: [`${base}/img/kimono.jpg`],
    });
    expect(byName['Silk Head Wrap']!.ref).toBe('/product/wrap');
    expect(byName['Silk Head Wrap']!.p).toMatchObject({
      externalId: `${base}/product/wrap#silk-head-wrap`,
      retailPrice: 350_000,
      photoUrls: [`${base}/img/wrap.jpg`],
    });
    expect(byName['Silk Head Wrap']!.p.variants.map((v) => [v.size, v.priceOverride])).toEqual([
      ['S', null],
      ['M', 400_000],
    ]);
    const errors = catalog.notes
      .filter((n) => n.level === 'error')
      .map((n) => catalog.products[n.position]!.name);
    expect(errors.sort()).toEqual(['Imported Bag', 'Mystery Item']);
  });

  it('without an AI key, reads only pages with product data', async () => {
    const catalog = await extractWebsiteCatalog(`${base}/product/kimono`, {
      anthropic: null,
      env,
      onUsage: async () => {},
    });
    expect(catalog.products.map((p) => p.name)).toEqual(['Ankara Kimono']);
    await expect(
      extractWebsiteCatalog(`${base}/product/wrap`, {
        anthropic: null,
        env,
        onUsage: async () => {},
      }),
    ).rejects.toThrow("isn't switched on");
  });

  it('explains pages that cannot be opened', async () => {
    await expect(
      extractWebsiteCatalog(`${base}/missing`, { anthropic: null, env, onUsage: async () => {} }),
    ).rejects.toThrow('could not open your website');
  });
});
