import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettingsInput } from '@fulcra/core';
import type * as PhotosModule from '../../core/src/agent/photos';
import type * as QueueModule from '../../core/src/jobs/queue';

// No queue in tests: record what would be sent.
const queuedSends: string[] = [];
vi.mock('../../core/src/jobs/queue', async (original) => ({
  ...(await original<typeof QueueModule>()),
  enqueueSendMessage: async (_b: string, id: string) => {
    queuedSends.push(id);
  },
}));

// No storage in tests: every photo "loads" except the ones marked unreadable.
const unreadable = new Set<string>();
vi.mock('../../core/src/agent/photos', async (original) => ({
  ...(await original<typeof PhotosModule>()),
  loadPhotoForAi: async (image: { path: string }) =>
    unreadable.has(image.path) ? null : { data: 'UklGRgAAAABXRUJQ', mediaType: 'image/webp' },
}));

const { schema, withTenant } = await import('@fulcra/db');
const { eq } = await import('drizzle-orm');
const core = await import('@fulcra/core');
const { FakePaystack } = await import('@fulcra/core/testing');
const { runAgentTurn } = await import('../src/run');

// ─── A scripted fake Claude ──────────────────────────────────────────────────

type Step =
  | { tool: string; input: Record<string, unknown> }
  | { text: string }
  | { json: Record<string, unknown> }
  | { refusal: true };
let script: ((body: { messages: { role: string; content: unknown }[] }) => Step)[] = [];
const requests: Record<string, unknown>[] = [];
let server: Server;
let client: Anthropic;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      const next = script.shift();
      if (!next)
        return res
          .writeHead(500)
          .end('{"type":"error","error":{"type":"api_error","message":"script ran out"}}');
      const step = next(body);
      const content =
        'tool' in step
          ? [{ type: 'tool_use', id: `toolu_${randomUUID()}`, name: step.tool, input: step.input }]
          : 'text' in step
            ? [{ type: 'text', text: step.text }]
            : 'json' in step
              ? [{ type: 'text', text: JSON.stringify(step.json) }]
              : [];
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: `msg_${randomUUID()}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content,
          stop_reason: 'tool' in step ? 'tool_use' : 'refusal' in step ? 'refusal' : 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 2500,
            output_tokens: 120,
            cache_read_input_tokens: 2000,
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
  unreadable.clear();
  queuedSends.length = 0;
  requests.length = 0;
  script = [];
  core.setPaystackClient(new FakePaystack());
});

/** The last tool result the assistant received (to script the next step from it). */
function lastToolResult(body: {
  messages: { role: string; content: unknown }[];
}): Record<string, unknown> {
  const last = body.messages.at(-1)!;
  const block = (last.content as { type: string; content: string }[]).find(
    (b) => b.type === 'tool_result',
  )!;
  return JSON.parse(block.content);
}

// ─── A shop with the assistant on ────────────────────────────────────────────

async function shop(settings: Partial<AgentSettingsInput> = {}) {
  const owner = { userId: randomUUID(), email: `own-${randomUUID()}@example.com` };
  const business = await core.createBusiness(owner, {
    name: `Ada Styles ${randomUUID().slice(0, 6)}`,
    category: 'fashion',
    whatsappNumber: '08031234567',
    subdomain: `ada-${randomUUID().slice(0, 8)}`,
  });
  const actor = { businessId: business.id, userId: owner.userId };
  const zone = await core.createDeliveryZone(actor, {
    name: 'Lekki',
    fee: 200_000,
    estimatedTime: 'Same day',
  });
  const dress = await core.createProduct(actor, {
    name: 'Ankara Midi Dress',
    category: 'Dresses',
    retailPrice: 1_500_000,
    wholesalePrice: 1_200_000,
    wholesaleMinQty: 6,
    options: {
      kind: 'variants',
      variants: [
        { size: 'M', colour: null, stock: 10 },
        { size: 'L', colour: null, stock: 0 },
      ],
    },
  });
  await core.createProduct(actor, {
    name: 'Ankara Maxi Gown',
    category: 'Dresses',
    retailPrice: 2_000_000,
    options: { kind: 'simple', stock: 3 },
  });
  await core.savePayoutAccount(actor, { bankCode: '058', accountNumber: '0123456789' });
  await core.saveAgentSettings(actor, { enabled: true, handoffTopics: ['discounts'], ...settings });
  const connection = await withTenant(business.id, async (tx) => {
    const [row] = await tx
      .insert(schema.channelConnections)
      .values({
        businessId: business.id,
        channel: 'whatsapp',
        externalAccountId: `pn-${randomUUID()}`,
      })
      .returning();
    return row!;
  });
  let conversationId = '';
  const say = async (text: string) => {
    const r = (await core.receiveInboundMessage(business.id, connection.id, {
      externalId: `wamid.${randomUUID()}`,
      from: { externalUserId: '2348031234567', displayName: 'Chioma' },
      sentAt: new Date().toISOString(),
      type: 'text',
      text,
    })) as { conversationId: string; messageId: string };
    conversationId = r.conversationId;
    return r;
  };
  /** The customer sends a photo (already stored, as a channel adapter would do). */
  const sendPhoto = async (caption = '', opts: { unreadable?: boolean } = {}) => {
    const path = `${business.id}/${randomUUID()}`;
    if (opts.unreadable) unreadable.add(path);
    const r = (await core.receiveInboundMessage(business.id, connection.id, {
      externalId: `wamid.${randomUUID()}`,
      from: { externalUserId: '2348031234567', displayName: 'Chioma' },
      sentAt: new Date().toISOString(),
      type: 'image',
      text: '',
      media: { mimeType: 'image/jpeg', caption, image: { path, width: 900, height: 1200 } },
    })) as { conversationId: string; messageId: string };
    conversationId = r.conversationId;
    return r;
  };
  const turn = async (messageId?: string) =>
    runAgentTurn({ businessId: business.id, conversationId, messageId, client });
  const chat = () => core.getConversation(actor, conversationId);
  const lastReply = async () =>
    (await chat()).messages.filter((m) => m.sender === 'agent').at(-1)?.text;
  const actions = () =>
    withTenant(business.id, (tx) =>
      tx
        .select()
        .from(schema.agentActions)
        .where(eq(schema.agentActions.conversationId, conversationId)),
    );
  const usage = () => withTenant(business.id, (tx) => tx.select().from(schema.usageRecords));
  return { business, actor, zone, dress, say, sendPhoto, turn, chat, lastReply, actions, usage };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

describe('assistant scenarios', () => {
  it('price question: looks the price up, answers, logs the call and its cost', async () => {
    const s = await shop();
    await s.say('How much is the Ankara dress?');
    script = [
      () => ({ tool: 'searchProducts', input: { query: 'ankara dress', category: null } }),
      (body) => {
        const found = lastToolResult(body).products as { name: string; price: string }[];
        const dress = found.find((p) => p.name === 'Ankara Midi Dress')!;
        return {
          text: `Hi Chioma! The Ankara Midi Dress is ${dress.price}. Which size would you like?`,
        };
      },
    ];
    const result = await s.turn();
    expect(result).toMatchObject({ status: 'replied', handedOff: false });
    expect(await s.lastReply()).toBe(
      'Hi Chioma! The Ankara Midi Dress is ₦15,000.00. Which size would you like?',
    );
    expect(queuedSends).toHaveLength(1);
    expect((await s.actions()).map((x) => [x.tool, x.ok])).toEqual([['searchProducts', true]]);
    const usage = await s.usage();
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({
      kind: 'ai_call',
      feature: 'agent.reply',
      model: 'claude-opus-5-5',
    });

    // The request: cached instructions, strict tools, refusal fallback, low effort, a turn note.
    const body = requests[0] as Record<string, unknown> & {
      system: { cache_control: unknown; text: string }[];
      tools: { strict: boolean }[];
      messages: { role: string }[];
    };
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'low' },
    });
    expect(body.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[0]!.text).toContain('Never state a price');
    expect(body.tools.every((t) => t.strict)).toBe(true);
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'system']);
  });

  it('sold-out option: offers what is in stock', async () => {
    const s = await shop();
    await s.say('I want the Ankara dress in size L');
    const l = s.dress.variants.find((v) => v.size === 'L')!;
    script = [
      () => ({ tool: 'checkStock', input: { variantId: l.id, quantity: 1 } }),
      () => ({ tool: 'suggestAlternatives', input: { productId: s.dress.product.id } }),
      (body) => {
        const alt = (lastToolResult(body).alternatives as { name: string; price: string }[])[0]!;
        return {
          text: `Size L is sold out, sorry. We have the ${alt.name} at ${alt.price}. Size M of the dress is also available.`,
        };
      },
    ];
    expect(await s.turn()).toMatchObject({ status: 'replied' });
    expect(await s.lastReply()).toContain('Ankara Maxi Gown at from ₦20,000.00');
  });

  it('wholesale quantity: quotes the wholesale price from the database', async () => {
    const s = await shop();
    await s.say('How much for 6 pieces of the dress in M?');
    const m = s.dress.variants.find((v) => v.size === 'M')!;
    script = [
      () => ({ tool: 'checkStock', input: { variantId: m.id, quantity: 6 } }),
      (body) => {
        const quote = lastToolResult(body);
        return { text: `For 6 pieces it's ${quote.unitPrice} each, ${quote.total} in total.` };
      },
    ];
    await s.turn();
    expect(await s.lastReply()).toBe("For 6 pieces it's ₦12,000.00 each, ₦72,000.00 in total.");
  });

  it('full order and payment link: creates the order and sends the link and exact total', async () => {
    const s = await shop();
    await s.say('Yes, 2 in size M, deliver to 12 Admiralty Way, Lekki. My name is Chioma Obi');
    const m = s.dress.variants.find((v) => v.size === 'M')!;
    script = [
      () => ({
        tool: 'createOrder',
        input: {
          items: [{ variantId: m.id, quantity: 2 }],
          fulfilment: 'delivery',
          deliveryZoneId: s.zone.id,
          deliveryAddress: '12 Admiralty Way, Lekki',
          customerName: 'Chioma Obi',
        },
      }),
      (body) => ({
        tool: 'sendPaymentLink',
        input: { orderNumber: lastToolResult(body).orderNumber as number },
      }),
      (body) => {
        const link = lastToolResult(body);
        return {
          text: `Your order #${link.orderNumber} is ${link.total}. Pay here: ${link.paymentLink}`,
        };
      },
    ];
    await s.turn();
    const reply = await s.lastReply();
    expect(reply).toMatch(/^Your order #1001 is ₦32,000\.00\. Pay here: https:\/\//);
    const orders = await core.listOrders(s.actor);
    expect(orders[0]).toMatchObject({
      orderNumber: 1001,
      total: 3_200_000,
      status: 'awaiting_payment',
    });
    const customer = await core.getCustomer(s.actor, (await s.chat()).customer.id);
    expect(customer.customer.name).toBe('Chioma');
  });

  it('"I\'ve sent it" with no payment: checks and says it has not arrived', async () => {
    const s = await shop();
    const m = s.dress.variants.find((v) => v.size === 'M')!;
    await s.say('I want 1 M, pickup');
    script = [
      () => ({
        tool: 'createOrder',
        input: {
          items: [{ variantId: m.id, quantity: 1 }],
          fulfilment: 'pickup',
          deliveryZoneId: null,
          deliveryAddress: '',
          customerName: '',
        },
      }),
      (body) => ({
        text: `Order #${lastToolResult(body).orderNumber} is ${lastToolResult(body).total}.`,
      }),
    ];
    await s.turn();
    await s.say("I've sent the money");
    script = [
      () => ({ tool: 'checkPaymentStatus', input: { orderNumber: 1001 } }),
      (body) => {
        const status = (lastToolResult(body).orders as { paid: boolean }[])[0]!;
        return {
          text: status.paid
            ? 'Payment received, thank you!'
            : "I can't see the payment yet. It's confirmed automatically once it lands, usually within minutes.",
        };
      },
    ];
    await s.turn();
    expect(await s.lastReply()).toContain("can't see the payment yet");
  });

  it('handoff: tells the customer, then passes the chat to the team', async () => {
    const s = await shop();
    await s.say('Can I get a discount? I want to talk to the owner');
    script = [
      () => ({ tool: 'handOffToHuman', input: { reason: 'Customer wants a discount' } }),
      () => ({ text: 'Let me get someone from the team for you. They will reply soon.' }),
    ];
    expect(await s.turn()).toMatchObject({ status: 'replied', handedOff: true });
    const view = await s.chat();
    expect(view.conversation).toMatchObject({
      handledBy: 'human',
      needsAttention: true,
      attentionReason: 'Customer wants a discount',
    });
    expect(view.messages.at(-1)).toMatchObject({
      sender: 'agent',
      text: 'Let me get someone from the team for you. They will reply soon.',
    });
    // The assistant no longer answers this chat.
    await s.say('Hello?');
    expect(await s.turn()).toEqual({ status: 'skipped' });
  });

  it('made-up price: the reply is blocked and the team takes over', async () => {
    const s = await shop();
    await s.say('Last price for the dress?');
    script = [() => ({ text: 'For you, special price ₦12,500 only!' })];
    expect(await s.turn()).toMatchObject({ status: 'not_sent' });
    const view = await s.chat();
    expect(view.messages.filter((m) => m.sender === 'agent')).toEqual([]);
    expect(view.conversation).toMatchObject({
      handledBy: 'human',
      attentionReason: 'The assistant was unsure about a price',
    });
    expect((await s.actions()).find((a) => a.tool === 'priceCheck')).toMatchObject({
      ok: false,
      output: { blocked: true, amounts: [1_250_000] },
    });
  });

  it('closed and not taking orders: away message once, then the chat waits for the team', async () => {
    const s = await shop({
      businessHours: {},
      afterHoursOrders: false,
      awayMessage: 'We are closed. We reply from 9am!',
    });
    await s.say('Hi');
    expect(await s.turn()).toEqual({ status: 'away' });
    expect(await s.lastReply()).toBe('We are closed. We reply from 9am!');
    expect(requests).toHaveLength(0); // no AI call needed
    await s.say('Hello?');
    expect(await s.turn()).toMatchObject({
      status: 'handed_off',
      reason: 'Customer wrote while you were closed',
    });
  });

  it('refusal or no AI key: hands off instead of going silent', async () => {
    const s = await shop();
    await s.say('Hi');
    script = [() => ({ refusal: true })];
    expect(await s.turn()).toMatchObject({
      status: 'handed_off',
      reason: 'The assistant could not answer this message',
    });
    const t = await shop();
    const { messageId } = await t.say('Hi');
    const result = await runAgentTurn({
      businessId: t.business.id,
      conversationId: (await t.chat()).conversation.id,
      messageId,
      client: null,
    });
    expect(result).toMatchObject({
      status: 'handed_off',
      reason: 'The assistant is not set up yet (no AI key)',
    });
  });

  it('a tool error is reported to the assistant, logged, and the turn continues', async () => {
    const s = await shop();
    await s.say('What about order 1234?');
    script = [
      () => ({ tool: 'getOrderStatus', input: { orderNumber: 1234 } }),
      () => ({ text: "I couldn't find that order. Could you check the number?" }),
    ];
    expect(await s.turn()).toMatchObject({ status: 'replied' });
    expect((await s.actions())[0]).toMatchObject({
      tool: 'getOrderStatus',
      ok: false,
      output: { error: 'This customer has no order #1234.' },
    });
  });

  it('photo of a product: looks at it once with the cheap model, searches, offers the closest match', async () => {
    const s = await shop();
    const sent = await s.sendPhoto('You get this one?');
    script = [
      () => ({
        json: {
          kind: 'product',
          description: 'A blue ankara maxi gown with puff sleeves.',
          textInPhoto: '₦35,000 @otherboutique',
          searchTerms: ['Ankara', 'gown', 'maxi', 'blue'],
        },
      }),
      () => ({ tool: 'searchProducts', input: { query: 'ankara gown maxi blue', category: null } }),
      (body) => {
        const top = (lastToolResult(body).products as { name: string; price: string }[])[0]!;
        return { text: `The closest we have is the ${top.name} at ${top.price}. Is this the one?` };
      },
    ];
    expect(await s.turn()).toMatchObject({ status: 'replied' });
    // Best match first: the gown matches more of the photo's words than the dress.
    expect(await s.lastReply()).toBe(
      'The closest we have is the Ankara Maxi Gown at ₦20,000.00. Is this the one?',
    );

    // 1st call: the photo, to the cheap model (no fallback parameter: Haiku rejects it).
    const look = requests[0] as {
      model: string;
      fallbacks?: unknown;
      messages: { content: { type: string; source?: { type: string } }[] }[];
    };
    expect(look.model).toBe('claude-haiku-5-5');
    expect(look.fallbacks).toBeUndefined();
    expect(look.messages[0]!.content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64' },
    });
    // 2nd call: the reply model reads the photo as text.
    const reply = JSON.stringify(requests[1]);
    expect(reply).toContain('It shows: A blue ankara maxi gown with puff sleeves.');
    expect(reply).toContain('Search words: ankara, gown, maxi, blue');
    expect(reply).not.toContain('"type":"image"');

    // Saved on the message, and costed as its own feature.
    const message = (await s.chat()).messages.find((m) => m.id === sent.messageId)!;
    expect(message.payload.photo).toMatchObject({
      kind: 'product',
      searchTerms: ['ankara', 'gown', 'maxi', 'blue'],
    });
    expect((await s.usage()).map((u) => [u.feature, u.model])).toContainEqual([
      'agent.photo',
      'claude-haiku-5-5',
    ]);

    // Next turn: the photo is not looked at again.
    requests.length = 0;
    await s.say('Ok. Size?');
    script = [() => ({ text: 'It comes in one size. Shall I reserve it?' })];
    await s.turn();
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain('It shows: A blue ankara maxi gown');
  });

  it('a price written on the photo is not ours: repeating it is blocked', async () => {
    const s = await shop();
    await s.sendPhoto('How much?');
    script = [
      () => ({
        json: {
          kind: 'product',
          description: 'A blue ankara maxi gown.',
          textInPhoto: '₦35,000',
          searchTerms: ['ankara', 'gown'],
        },
      }),
      () => ({ text: 'It is ₦35,000.' }),
    ];
    expect(await s.turn()).toMatchObject({ status: 'not_sent' });
    expect((await s.chat()).conversation.attentionReason).toBe(
      'The assistant was unsure about a price',
    );
  });

  it('payment screenshot: not taken as proof, the payment is checked', async () => {
    const s = await shop();
    await s.sendPhoto('I have paid');
    script = [
      () => ({
        json: {
          kind: 'payment_proof',
          description: 'A bank app screenshot of a successful transfer.',
          textInPhoto: 'Transfer successful ₦15,000 to Ada Styles',
          searchTerms: [],
        },
      }),
      (body) => {
        expect(JSON.stringify(body)).toContain('not proof. Check with checkPaymentStatus');
        return { tool: 'getOrderStatus', input: { orderNumber: null } };
      },
      () => ({
        text: "Thanks! I can't see a payment on your orders yet. It's confirmed automatically once it lands.",
      }),
    ];
    expect(await s.turn()).toMatchObject({ status: 'replied' });
    expect((await s.actions()).map((a) => [a.tool, a.ok])).toEqual([['getOrderStatus', true]]);
  });

  it('a photo that cannot be loaded: the assistant is told it could not see it', async () => {
    const s = await shop();
    await s.sendPhoto('', { unreadable: true });
    script = [() => ({ text: "Sorry, I couldn't open your photo. What item is it?" })];
    expect(await s.turn()).toMatchObject({ status: 'replied' });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).toContain('a photo you could not see');
  });
});
