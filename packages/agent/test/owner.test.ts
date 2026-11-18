import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QueueModule from '../../core/src/jobs/queue';

// No queue in tests: remember the owner-message jobs that would run.
const jobs: { businessId: string; chatId: string; messageId: string }[] = [];
vi.mock('../../core/src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueOwnerMessage: async (businessId: string, chatId: string, messageId: string) => {
    jobs.push({ businessId, chatId, messageId });
  },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const core = await import('@fulcra/core');
const { runOwnerTurn } = await import('../src/owner');

// ─── A scripted fake Claude ──────────────────────────────────────────────────
type Step = { tool: string; input: Record<string, unknown> } | { text: string };
type Body = { messages: { role: string; content: unknown }[]; tools: { name: string }[] };
let script: ((body: Body) => Step)[] = [];
const requests: Body[] = [];
let server: Server;
let client: Anthropic;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw) as Body & { model: string };
      requests.push(body);
      const next = script.shift();
      if (!next)
        return res
          .writeHead(500)
          .end('{"type":"error","error":{"type":"api_error","message":"script ran out"}}');
      const step = next(body);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: `msg_${randomUUID()}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content:
            'tool' in step
              ? [
                  {
                    type: 'tool_use',
                    id: `toolu_${randomUUID()}`,
                    name: step.tool,
                    input: step.input,
                  },
                ]
              : [{ type: 'text', text: step.text }],
          stop_reason: 'tool' in step ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1800,
            output_tokens: 90,
            cache_read_input_tokens: 1500,
            cache_creation_input_tokens: 0,
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  client = new Anthropic({
    apiKey: 'test',
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    maxRetries: 0,
  });
});
afterAll(() => server.close());
beforeEach(() => {
  script = [];
  requests.length = 0;
});

function lastToolResult(body: Body): Record<string, unknown> {
  const last = body.messages.at(-1)!;
  const block = (last.content as { type: string; content: string }[]).find(
    (b) => b.type === 'tool_result',
  )!;
  return JSON.parse(block.content);
}

async function shop() {
  const owner = { userId: randomUUID(), email: `own-${randomUUID()}@example.com` };
  const business = await core.createBusiness(owner, {
    name: `Ada Styles ${randomUUID().slice(0, 6)}`,
    category: 'fashion',
    whatsappNumber: '08031234567',
    subdomain: `ada-${randomUUID().slice(0, 8)}`,
  });
  const actor = { businessId: business.id, userId: owner.userId };
  const dress = await core.createProduct(actor, {
    name: 'Ankara Midi Dress',
    retailPrice: 1_500_000,
    options: {
      kind: 'variants',
      variants: [
        { size: 'M', colour: null, stock: 10 },
        { size: 'L', colour: null, stock: 2 },
      ],
    },
  });
  /** The owner writes in the dashboard, then the worker job runs the assistant. */
  const ask = async (text: string, image?: { path: string; width: number; height: number }) => {
    await core.sendOwnerDashboardMessage(actor, { text, image });
    const job = jobs.filter((j) => j.businessId === business.id).at(-1)!;
    return runOwnerTurn({ ...job, client });
  };
  const lastReply = async () =>
    (await core.getOwnerDashboardChat(actor)).messages
      .filter((m) => m.sender === 'assistant')
      .at(-1)?.text;
  return { business, actor, dress, ask, lastReply };
}

describe("owner's assistant", () => {
  it('answers a sales question from the data, and its cost is recorded', async () => {
    const s = await shop();
    const variant = s.dress.variants[0]!;
    const { order } = await core.createOrder(s.actor, {
      customer: { name: 'Chioma', phone: '08051112222' },
      items: [{ variantId: variant.id, quantity: 2 }],
      fulfilment: 'pickup',
    });
    await core.markOrderPaid(s.actor, order.id, { method: 'cash' });
    script = [
      () => ({ tool: 'salesSummary', input: { period: 'today' } }),
      (body) => {
        const r = lastToolResult(body);
        expect(r).toMatchObject({ paidOrders: 1, amount: '₦30,000.00' });
        return { text: `You sold ${r.amount} today from ${r.paidOrders} paid order. 🎉` };
      },
    ];
    expect(await s.ask('Abeg how much I sell today?')).toMatchObject({ status: 'replied' });
    expect(await s.lastReply()).toBe('You sold ₦30,000.00 today from 1 paid order. 🎉');
    // Pidgin-friendly instructions and only owner tools.
    expect(requests[0]!.tools.map((t) => t.name)).toContain('proposeAddProduct');
    expect(requests[0]!.tools.map((t) => t.name)).not.toContain('sendPaymentLink');
    const usage = await withTenant(s.business.id, (tx) =>
      tx
        .select()
        .from(schema.usageRecords)
        .where(eq(schema.usageRecords.feature, 'owner.assistant')),
    );
    expect(usage).toHaveLength(2);
  });

  it('adds a product from a photo only after YES', async () => {
    const s = await shop();
    const photo = { path: `${s.business.id}/${randomUUID()}`, width: 800, height: 800 };
    script = [
      (body) => {
        expect(JSON.stringify(body.messages)).toContain('[The owner sent a photo]');
        return {
          tool: 'proposeAddProduct',
          input: {
            name: 'Adire Top',
            priceNaira: 12000,
            stock: 4,
            description: '',
            category: null,
            usePhoto: true,
          },
        };
      },
      (body) => ({ text: `${lastToolResult(body).summary}? Reply YES to confirm.` }),
    ];
    await s.ask('New one: Adire top, 12k, 4 pieces', photo);
    expect(await s.lastReply()).toBe(
      'Add "Adire Top" at ₦12,000.00 with 4 in stock, using the photo you sent? Reply YES to confirm.',
    );
    expect(
      await withTenant(s.business.id, (tx) =>
        tx.select().from(schema.products).where(eq(schema.products.name, 'Adire Top')),
      ),
    ).toHaveLength(0);

    await core.sendOwnerDashboardMessage(s.actor, { text: 'yes' }); // handled without the AI
    const [created] = await withTenant(s.business.id, (tx) =>
      tx.select().from(schema.products).where(eq(schema.products.name, 'Adire Top')),
    );
    expect(created).toMatchObject({ retailPrice: 1_200_000, photos: [photo] });
    expect(await s.lastReply()).toContain('Done. "Adire Top" is in your catalog');
  });

  it('finds the right option before changing stock', async () => {
    const s = await shop();
    script = [
      () => ({ tool: 'findProducts', input: { query: 'ankara midi' } }),
      (body) => {
        const [p] = lastToolResult(body) as unknown as {
          options: { variantId: string; label: string }[];
        }[];
        const large = p!.options.find((o) => o.label === 'L')!;
        return { tool: 'proposeSetStock', input: { variantId: large.variantId, stock: 7 } };
      },
      (body) => ({ text: `${lastToolResult(body).summary}? Reply YES.` }),
    ];
    await s.ask('Ankara midi size L, set am to 7');
    expect(await s.lastReply()).toBe(
      'Set stock of "Ankara Midi Dress (L)" from 2 to 7? Reply YES.',
    );
    await core.sendOwnerDashboardMessage(s.actor, { text: 'Yes please' });
    const product = await core.getProduct(s.actor, s.dress.product.id);
    expect(product.variants.find((v) => v.size === 'L')!.stock).toBe(7);
  });

  it('answers "any fake alerts?" from the payment checks, amounts in naira', async () => {
    const s = await shop();
    const { order } = await core.createOrder(s.actor, {
      customer: { name: 'Chioma', phone: '08051112222' },
      items: [{ variantId: s.dress.variants[0]!.id, quantity: 1 }],
      fulfilment: 'pickup',
    });
    await withTenant(s.business.id, (tx) =>
      tx.insert(schema.paymentClaims).values({
        businessId: s.business.id,
        customerId: order.customerId,
        orderId: order.id,
        source: 'screenshot',
        status: 'not_received',
        claimedAmount: 1_200_000,
        receivedAmount: 0,
        bank: 'Opay',
        flags: ['amount_mismatch'],
      }),
    );
    script = [
      () => ({ tool: 'paymentChecks', input: { which: 'open' } }),
      (body) => {
        const r = lastToolResult(body) as {
          note: string;
          checks: {
            customer: string;
            status: string;
            screenshotAmount: string;
            received: string;
            warnings: string[];
          }[];
        };
        expect(r.note).toMatch(/never proof/);
        expect(r.checks).toEqual([
          expect.objectContaining({
            customer: 'Chioma',
            status: 'Nothing arrived',
            screenshotAmount: '₦12,000.00',
            received: '₦0.00',
            orderTotal: '₦15,000.00',
            warnings: ["The amount on the screenshot isn't what the order costs"],
          }),
        ]);
        const c = r.checks[0]!;
        return {
          text: `${c.customer} sent a screenshot for ${c.screenshotAmount}, but ${c.received} has arrived. Don't send the goods yet.`,
        };
      },
    ];
    expect(await s.ask('Any fake alert today?')).toMatchObject({ status: 'replied' });
    expect(await s.lastReply()).toBe(
      "Chioma sent a screenshot for ₦12,000.00, but ₦0.00 has arrived. Don't send the goods yet.",
    );
  });

  it('never sends an amount that did not come from the data', async () => {
    const s = await shop();
    script = [() => ({ text: 'You made ₦99,000 this week!' })];
    expect(await s.ask('How much this week?')).toMatchObject({ status: 'not_sent' });
    expect(await s.lastReply()).toContain("I wasn't sure about an amount");
  });

  it('says it is not switched on without an AI key', async () => {
    const s = await shop();
    await core.sendOwnerDashboardMessage(s.actor, { text: 'hi' });
    const job = jobs.filter((j) => j.businessId === s.business.id).at(-1)!;
    expect(await runOwnerTurn({ ...job, client: null })).toMatchObject({ status: 'replied' });
    expect(await s.lastReply()).toContain("I'm not switched on yet");
  });
});
