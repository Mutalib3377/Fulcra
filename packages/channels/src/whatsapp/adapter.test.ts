import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ChannelSendError } from '../types';
import {
  createWhatsAppTemplate,
  exchangeEmbeddedSignupCode,
  lookupWhatsAppNumber,
  registerWhatsAppNumber,
  verifyWhatsAppSignature,
  whatsAppAdapter as wa,
} from './adapter';

// ─── A fake Graph API ────────────────────────────────────────────────────────

type Seen = { method: string; path: string; auth: string | undefined; body: unknown };
const seen: Seen[] = [];
let respond: (req: Seen) => { status?: number; body: unknown; raw?: Buffer } = () => ({
  body: { messages: [{ id: 'wamid.SENT' }] },
});
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method!,
        path: req.url!,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      };
      seen.push(entry);
      const out = respond(entry);
      res.statusCode = out.status ?? 200;
      if (out.raw) return res.end(out.raw);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.WHATSAPP_GRAPH_URL = base;
  process.env.WHATSAPP_GRAPH_VERSION = 'v26.0';
});
afterAll(() => server.close());
beforeEach(() => {
  seen.length = 0;
  respond = () => ({ body: { messages: [{ id: 'wamid.SENT' }] } });
});

const credentials = JSON.stringify({ accessToken: 'EAAtoken' });

// ─── Signature ───────────────────────────────────────────────────────────────

describe('webhook signature', () => {
  it('accepts only bodies signed with the app secret', () => {
    const body = '{"object":"whatsapp_business_account"}';
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(verifyWhatsAppSignature(body, sig, 'app-secret')).toBe(true);
    expect(verifyWhatsAppSignature(body + ' ', sig, 'app-secret')).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, 'other')).toBe(false);
    expect(verifyWhatsAppSignature(body, null, 'app-secret')).toBe(false);
    expect(verifyWhatsAppSignature(body, sig, undefined)).toBe(false);
    expect(verifyWhatsAppSignature(body, 'sha256=zz', 'app-secret')).toBe(false);
  });
});

// ─── Parsing (shapes as Meta sends them) ─────────────────────────────────────

const webhook = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
            ...value,
          },
        },
      ],
    },
  ],
});

describe('parsing webhooks', () => {
  it('turns customer messages into standard messages', () => {
    const from = '2348031234567';
    const msg = (id: string, rest: Record<string, unknown>) => ({
      from,
      id,
      timestamp: '1762700000',
      ...rest,
    });
    const parsed = wa.parseWebhook(
      webhook({
        contacts: [{ profile: { name: 'Chioma Obi' }, wa_id: from }],
        messages: [
          msg('wamid.1', { type: 'text', text: { body: 'How much is the gown?' } }),
          msg('wamid.2', {
            type: 'image',
            image: { id: '1234567890', mime_type: 'image/jpeg', sha256: 'x', caption: 'This one' },
          }),
          msg('wamid.3', {
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'size-m', title: 'M' } },
          }),
          msg('wamid.4', {
            type: 'location',
            location: { latitude: 6.43, longitude: 3.42, name: 'Lekki Phase 1' },
          }),
          msg('wamid.5', { type: 'reaction', reaction: { message_id: 'wamid.1', emoji: '👍' } }),
          msg('wamid.6', { type: 'sticker', sticker: { id: '1' } }),
        ],
      }),
    );
    expect(parsed.statuses).toEqual([]);
    expect(parsed.messages.map((m) => m.accountId)).toEqual(Array(5).fill('106540352242922'));
    const [text, image, button, location, sticker] = parsed.messages.map((m) => m.message);
    expect(text).toMatchObject({
      externalId: 'wamid.1',
      from: { externalUserId: from, displayName: 'Chioma Obi' },
      type: 'text',
      text: 'How much is the gown?',
      sentAt: new Date(1762700000 * 1000),
    });
    expect(image).toMatchObject({
      type: 'image',
      media: { providerMediaId: '1234567890', mimeType: 'image/jpeg', caption: 'This one' },
    });
    expect(button).toMatchObject({ type: 'button_reply', text: 'M', replyId: 'size-m' });
    expect(location).toMatchObject({
      type: 'location',
      text: 'Lekki Phase 1',
      location: { latitude: 6.43, longitude: 3.42 },
    });
    expect(sticker).toMatchObject({ type: 'unsupported', externalId: 'wamid.6' });
  });

  it('turns delivery updates into status updates with pricing and plain error reasons', () => {
    const parsed = wa.parseWebhook(
      webhook({
        statuses: [
          {
            id: 'wamid.A',
            status: 'delivered',
            timestamp: '1762700001',
            recipient_id: '2348031234567',
            pricing: { billable: true, pricing_model: 'PMP', category: 'service', type: 'regular' },
          },
          {
            id: 'wamid.B',
            status: 'failed',
            timestamp: '1762700002',
            recipient_id: '2348031234567',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.C', status: 'deleted', timestamp: '1' },
        ],
      }),
    );
    expect(parsed.messages).toEqual([]);
    expect(parsed.statuses).toEqual([
      {
        accountId: '106540352242922',
        update: {
          externalId: 'wamid.A',
          status: 'delivered',
          pricing: { billable: true, category: 'service' },
        },
      },
      {
        accountId: '106540352242922',
        update: {
          externalId: 'wamid.B',
          status: 'failed',
          error: expect.stringContaining('more than 24 hours'),
        },
      },
    ]);
  });

  it('ignores anything that is not a WhatsApp messages webhook', () => {
    expect(wa.parseWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(wa.parseWebhook('nonsense')).toEqual({ messages: [], statuses: [] });
    const other = webhook({});
    other.entry[0]!.changes[0]!.field = 'message_template_status_update';
    expect(wa.parseWebhook(other)).toEqual({ messages: [], statuses: [] });
  });
});

// ─── Sending ─────────────────────────────────────────────────────────────────

describe('sending', () => {
  const send = (message: Parameters<typeof wa.send>[0]['message']) =>
    wa.send({ accountId: '106540352242922', credentials, to: '2348031234567', message });

  it('sends text, photos, buttons and lists in WhatsApp format', async () => {
    expect(await send({ type: 'text', text: 'Hi Chioma' })).toEqual({ externalId: 'wamid.SENT' });
    await send({ type: 'image', imageUrl: 'https://cdn.example.com/a.webp', caption: 'The gown' });
    await send({
      type: 'buttons',
      text: 'Which size?',
      buttons: [
        { id: 'm', title: 'M' },
        { id: 'l', title: 'L' },
      ],
    });
    await send({
      type: 'list',
      text: 'Pick one',
      buttonLabel: 'See options',
      rows: [{ id: 'g', title: 'Maxi Gown', description: '₦20,000.00' }],
    });
    expect(seen.map((s) => [s.method, s.path, s.auth])).toEqual(
      Array(4).fill(['POST', '/v26.0/106540352242922/messages', 'Bearer EAAtoken']),
    );
    expect(seen[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '2348031234567',
      type: 'text',
      text: { body: 'Hi Chioma', preview_url: true },
    });
    expect(seen[1]!.body).toMatchObject({
      type: 'image',
      image: { link: 'https://cdn.example.com/a.webp', caption: 'The gown' },
    });
    expect(seen[2]!.body).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Which size?' },
        action: { buttons: [{ type: 'reply', reply: { id: 'm', title: 'M' } }, expect.anything()] },
      },
    });
    expect(seen[3]!.body).toMatchObject({
      interactive: {
        type: 'list',
        action: {
          button: 'See options',
          sections: [{ rows: [{ id: 'g', title: 'Maxi Gown', description: '₦20,000.00' }] }],
        },
      },
    });
  });

  it('turns Meta errors into retry / give up / reconnect', async () => {
    const fail = (status: number, code: number) => () => ({
      status,
      body: { error: { message: 'x', type: 'OAuthException', code } },
    });
    const attempt = async () => {
      try {
        await send({ type: 'text', text: 'Hi' });
      } catch (error) {
        return error as ChannelSendError;
      }
      throw new Error('expected a failure');
    };
    respond = fail(400, 131047);
    expect(await attempt()).toMatchObject({ retry: false, connectionBroken: false });
    expect((await attempt()).message).toContain('24 hours');
    respond = fail(401, 190);
    expect(await attempt()).toMatchObject({ retry: false, connectionBroken: true });
    respond = fail(429, 130429);
    expect(await attempt()).toMatchObject({ retry: true });
    respond = fail(500, 1);
    expect(await attempt()).toMatchObject({ retry: true });
    respond = fail(400, 100);
    expect(await attempt()).toMatchObject({ retry: false, connectionBroken: false });

    await expect(
      wa.send({ accountId: '1', credentials: null, to: '2', message: { type: 'text', text: 'x' } }),
    ).rejects.toMatchObject({ connectionBroken: true });
  });

  it('marks a message read with "typing…"', async () => {
    respond = () => ({ body: { success: true } });
    await wa.markRead!({
      accountId: '106540352242922',
      credentials,
      externalMessageId: 'wamid.1',
      typing: true,
    });
    expect(seen[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.1',
      typing_indicator: { type: 'text' },
    });
  });
});

// ─── Media and number lookup ─────────────────────────────────────────────────

describe('media and number checks', () => {
  it('downloads a customer photo in two steps, with the token', async () => {
    respond = (req) =>
      req.path === '/v26.0/1234567890'
        ? { body: { url: `${base}/media-file/abc`, mime_type: 'image/jpeg', file_size: 4 } }
        : { raw: Buffer.from([1, 2, 3, 4]), body: null };
    const media = await wa.downloadMedia!({ credentials, mediaId: '1234567890' });
    expect(Array.from(media.data)).toEqual([1, 2, 3, 4]);
    expect(media.mimeType).toBe('image/jpeg');
    expect(seen.map((s) => [s.path, s.auth])).toEqual([
      ['/v26.0/1234567890', 'Bearer EAAtoken'],
      ['/media-file/abc', 'Bearer EAAtoken'],
    ]);
  });

  it('checks a number and token with Meta', async () => {
    respond = () => ({
      body: { display_phone_number: '+1 555-078-3881', verified_name: 'Test Number', id: '1' },
    });
    expect(await lookupWhatsAppNumber('106540352242922', 'EAAtoken')).toEqual({
      displayPhoneNumber: '+1 555-078-3881',
      verifiedName: 'Test Number',
    });
    expect(seen[0]!.path).toBe('/v26.0/106540352242922?fields=display_phone_number,verified_name');
    respond = () => ({ status: 400, body: { error: { message: 'Invalid OAuth', code: 190 } } });
    await expect(lookupWhatsAppNumber('1', 'bad')).rejects.toMatchObject({ code: 190 });
  });
});

// ─── Templates and Embedded Signup ───────────────────────────────────────────

describe('templates', () => {
  it('reads template reviews from webhooks', () => {
    const parsed = wa.parseWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          time: 1762700000,
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'REJECTED',
                message_template_id: 594425479261596,
                message_template_name: 'fulcra_order_update_v1',
                message_template_language: 'en',
                reason: 'INVALID_FORMAT',
              },
            },
          ],
        },
      ],
    });
    expect(parsed).toEqual({
      messages: [],
      statuses: [],
      templates: [
        {
          businessAccountId: '102290129340398',
          externalId: '594425479261596',
          name: 'fulcra_order_update_v1',
          language: 'en',
          status: 'REJECTED',
          reason: 'INVALID_FORMAT',
        },
      ],
    });
  });

  it('sends an approved template with its values', async () => {
    await wa.send({
      accountId: '106540352242922',
      credentials,
      to: '2348031234567',
      message: {
        type: 'template',
        name: 'fulcra_payment_receipt_v1',
        language: 'en',
        params: ['Chioma', '₦17,000.00'],
        text: 'Hi Chioma…',
      },
    });
    expect(seen[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '2348031234567',
      type: 'template',
      template: {
        name: 'fulcra_payment_receipt_v1',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Chioma' },
              { type: 'text', text: '₦17,000.00' },
            ],
          },
        ],
      },
    });
  });

  it('submits a template for review, or finds it when the name already exists', async () => {
    const tpl = {
      name: 'fulcra_reply_request_v1',
      language: 'en',
      category: 'utility',
      body: 'Hi {{1}}, this is {{2}} following up.',
      examples: ['Chioma', 'Ada Styles'],
    };
    respond = () => ({ body: { id: '777', status: 'PENDING', category: 'UTILITY' } });
    expect(await createWhatsAppTemplate('102290129340398', 'EAAtoken', tpl)).toEqual({
      externalId: '777',
      status: 'PENDING',
    });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      path: '/v26.0/102290129340398/message_templates',
      body: {
        name: 'fulcra_reply_request_v1',
        language: 'en',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: 'Hi {{1}}, this is {{2}} following up.',
            example: { body_text: [['Chioma', 'Ada Styles']] },
          },
        ],
      },
    });

    seen.length = 0;
    respond = (req) =>
      req.method === 'POST'
        ? {
            status: 400,
            body: { error: { message: 'Invalid parameter', code: 100, error_subcode: 2388024 } },
          }
        : {
            body: {
              data: [
                { id: '778', name: 'fulcra_reply_request_v1', language: 'fr', status: 'PENDING' },
                { id: '779', name: 'fulcra_reply_request_v1', language: 'en', status: 'APPROVED' },
              ],
            },
          };
    expect(await createWhatsAppTemplate('102290129340398', 'EAAtoken', tpl)).toEqual({
      externalId: '779',
      status: 'APPROVED',
    });
    expect(seen[1]!.path).toContain('/message_templates?name=fulcra_reply_request_v1');
  });

  it('Embedded Signup: exchanges the code for a token and registers the number', async () => {
    respond = () => ({ body: { access_token: 'EAAbusiness', token_type: 'bearer' } });
    const token = await exchangeEmbeddedSignupCode('the-code', {
      ...process.env,
      META_APP_ID: '1234',
      META_APP_SECRET: 'shh',
    });
    expect(token).toBe('EAAbusiness');
    expect(seen[0]).toMatchObject({
      method: 'GET',
      path: '/v26.0/oauth/access_token?client_id=1234&client_secret=shh&code=the-code',
      auth: undefined,
    });
    await expect(
      exchangeEmbeddedSignupCode('x', { ...process.env, META_APP_ID: '' }),
    ).rejects.toThrow('Meta app keys are not set');

    respond = () => ({ body: { success: true } });
    await registerWhatsAppNumber('106540352242922', 'EAAbusiness', '123456');
    expect(seen.at(-1)).toMatchObject({
      method: 'POST',
      path: '/v26.0/106540352242922/register',
      auth: 'Bearer EAAbusiness',
      body: { messaging_product: 'whatsapp', pin: '123456' },
    });
  });
});
