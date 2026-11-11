import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  exchangeInstagramCode,
  instagramAdapter as ig,
  instagramAuthorizeUrl,
  refreshInstagramToken,
  subscribeInstagramApp,
  verifyInstagramSignature,
} from './adapter';

type Seen = { method: string; path: string; auth: string | undefined; body: string };
const seen: Seen[] = [];
let respond: (req: Seen) => { status?: number; body: unknown; raw?: Buffer } = () => ({
  body: { recipient_id: '9001', message_id: 'aWdfZAG1sent' },
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
        body: raw,
      };
      seen.push(entry);
      const out = respond(entry);
      res.statusCode = out.status ?? 200;
      if (out.raw) {
        res.setHeader('content-type', 'image/jpeg');
        return res.end(out.raw);
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.INSTAGRAM_TEST_BASE_URL = base;
  process.env.INSTAGRAM_GRAPH_VERSION = 'v26.0';
});
afterAll(() => server.close());
beforeEach(() => {
  seen.length = 0;
  respond = () => ({ body: { recipient_id: '9001', message_id: 'aWdfZAG1sent' } });
});

const credentials = JSON.stringify({ accessToken: 'IGtoken' });
const ACCOUNT = '17841400000000001';

describe('login and tokens', () => {
  it('builds the login link with messaging permission', () => {
    const url = new URL(
      instagramAuthorizeUrl({ appId: '123', redirectUri: 'https://app.x/cb', state: 's1' }),
    );
    expect(url.pathname).toBe('/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      redirect_uri: 'https://app.x/cb',
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      state: 's1',
    });
  });

  it('code → short token → 60-day token → account; refresh; subscribe', async () => {
    respond = (req) => {
      if (req.path === '/oauth/access_token')
        return { body: { access_token: 'short', user_id: 1 } };
      if (req.path.startsWith('/access_token?'))
        return { body: { access_token: 'long', token_type: 'bearer', expires_in: 5_184_000 } };
      if (req.path.startsWith('/v26.0/me?'))
        return { body: { user_id: ACCOUNT, username: 'adastyles', name: 'Ada Styles', id: 'x' } };
      if (req.path.startsWith('/refresh_access_token?'))
        return { body: { access_token: 'renewed', expires_in: 5_184_000 } };
      return { body: { success: true } };
    };
    const now = new Date('2026-11-11T10:00:00Z');
    const result = await exchangeInstagramCode({
      code: 'abc#_',
      redirectUri: 'https://app.x/cb',
      config: { appId: '123', appSecret: 'shh' },
      now,
    });
    expect(result).toEqual({
      accessToken: 'long',
      expiresAt: new Date(now.getTime() + 60 * 86_400_000),
      accountId: ACCOUNT,
      username: 'adastyles',
      name: 'Ada Styles',
    });
    expect(Object.fromEntries(new URLSearchParams(seen[0]!.body))).toEqual({
      client_id: '123',
      client_secret: 'shh',
      grant_type: 'authorization_code',
      redirect_uri: 'https://app.x/cb',
      code: 'abc',
    });
    expect(seen[1]!.path).toBe(
      '/access_token?grant_type=ig_exchange_token&client_secret=shh&access_token=short',
    );
    expect(seen[2]!.auth).toBe('Bearer long');

    const renewed = await refreshInstagramToken('long', now);
    expect(renewed.accessToken).toBe('renewed');
    expect(seen[3]!.path).toBe(
      '/refresh_access_token?grant_type=ig_refresh_token&access_token=long',
    );

    await subscribeInstagramApp('long');
    expect(seen[4]).toMatchObject({
      method: 'POST',
      path: '/v26.0/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_seen',
      auth: 'Bearer long',
    });
  });

  it('checks the webhook signature with the Instagram app secret', () => {
    const body = '{"object":"instagram"}';
    const sig = `sha256=${createHmac('sha256', 'ig-secret').update(body).digest('hex')}`;
    expect(verifyInstagramSignature(body, sig, 'ig-secret')).toBe(true);
    expect(verifyInstagramSignature(body, sig, 'other')).toBe(false);
    expect(verifyInstagramSignature(body, null, 'ig-secret')).toBe(false);
  });
});

describe('parsing webhooks', () => {
  const event = (rest: Record<string, unknown>) => ({
    sender: { id: '9001' },
    recipient: { id: ACCOUNT },
    timestamp: 1762850000000,
    ...rest,
  });
  const hook = (...messaging: Record<string, unknown>[]) => ({
    object: 'instagram',
    entry: [{ id: ACCOUNT, time: 1762850000000, messaging }],
  });

  it('turns DMs into standard messages and ignores our own echoes', () => {
    const parsed = ig.parseWebhook(
      hook(
        event({ message: { mid: 'm1', text: 'How much is the gown?' } }),
        event({
          message: {
            mid: 'm2',
            attachments: [
              { type: 'image', payload: { url: 'https://lookaside.example/p.jpg?x=1' } },
            ],
          },
        }),
        event({ message: { mid: 'm3', text: 'M', quick_reply: { payload: 'size-m' } } }),
        event({ postback: { mid: 'm4', title: 'Buy now', payload: 'buy' } }),
        event({
          message: {
            mid: 'm5',
            text: 'Love this!',
            reply_to: { story: { id: 's1', url: 'https://x' } },
          },
        }),
        event({
          message: { mid: 'm6', attachments: [{ type: 'ig_reel', payload: { url: 'https://x' } }] },
        }),
        {
          sender: { id: ACCOUNT },
          recipient: { id: '9001' },
          timestamp: 1,
          message: { mid: 'm7', text: 'echo', is_echo: true },
        },
        event({ read: { mid: 'sent-1' } }),
      ),
    );
    const messages = parsed.messages.map((m) => m.message);
    expect(parsed.messages.every((m) => m.accountId === ACCOUNT)).toBe(true);
    expect(messages.map((m) => [m.externalId, m.type])).toEqual([
      ['m1', 'text'],
      ['m2', 'image'],
      ['m3', 'button_reply'],
      ['m4', 'button_reply'],
      ['m5', 'text'],
      ['m6', 'unsupported'],
    ]);
    expect(messages[0]).toMatchObject({
      from: { externalUserId: '9001' },
      text: 'How much is the gown?',
      sentAt: new Date(1762850000000),
    });
    expect(messages[1]!.media).toEqual({ url: 'https://lookaside.example/p.jpg?x=1' });
    expect(messages[2]).toMatchObject({ text: 'M', replyId: 'size-m' });
    expect(messages[3]).toMatchObject({ text: 'Buy now', replyId: 'buy' });
    expect(messages[4]!.text).toBe('[Replying to your story] Love this!');
    expect(parsed.statuses).toEqual([
      { accountId: ACCOUNT, update: { externalId: 'sent-1', status: 'read' } },
    ]);
    expect(ig.parseWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [] });
  });
});

describe('sending', () => {
  const send = (message: Parameters<typeof ig.send>[0]['message']) =>
    ig.send({ accountId: ACCOUNT, credentials, to: '9001', message });

  it('sends text, photos and quick replies', async () => {
    expect(await send({ type: 'text', text: 'Hi!' })).toEqual({ externalId: 'aWdfZAG1sent' });
    await send({ type: 'image', imageUrl: 'https://cdn.example.com/a.webp' });
    await send({ type: 'buttons', text: 'Which size?', buttons: [{ id: 'm', title: 'M' }] });
    expect(seen.map((s) => [s.method, s.path, s.auth])).toEqual(
      Array(3).fill(['POST', `/v26.0/${ACCOUNT}/messages`, 'Bearer IGtoken']),
    );
    expect(seen.map((s) => JSON.parse(s.body))).toEqual([
      { recipient: { id: '9001' }, message: { text: 'Hi!' } },
      {
        recipient: { id: '9001' },
        message: {
          attachment: { type: 'image', payload: { url: 'https://cdn.example.com/a.webp' } },
        },
      },
      {
        recipient: { id: '9001' },
        message: {
          text: 'Which size?',
          quick_replies: [{ content_type: 'text', title: 'M', payload: 'm' }],
        },
      },
    ]);
  });

  it('turns Instagram errors into retry / give up / reconnect', async () => {
    const fail = (status: number, code: number, subcode?: number) => () => ({
      status,
      body: { error: { message: 'x', code, error_subcode: subcode } },
    });
    const attempt = () =>
      send({ type: 'text', text: 'Hi' }).then(
        () => null,
        (e: unknown) => e,
      );
    respond = fail(400, 10, 2534022);
    expect(await attempt()).toMatchObject({
      retry: false,
      connectionBroken: false,
      message: expect.stringContaining('24 hours'),
    });
    respond = fail(401, 190);
    expect(await attempt()).toMatchObject({ retry: false, connectionBroken: true });
    respond = fail(429, 4);
    expect(await attempt()).toMatchObject({ retry: true });
    respond = fail(500, 2);
    expect(await attempt()).toMatchObject({ retry: true });
  });

  it('downloads a customer photo from its link, and looks up the customer’s name', async () => {
    respond = (req) =>
      req.path.startsWith('/media')
        ? { raw: Buffer.from([1, 2, 3]), body: null }
        : { body: { name: 'Chioma Obi', username: 'chioma' } };
    const media = await ig.downloadMedia!({ credentials, mediaId: `${base}/media/p.jpg` });
    expect(Array.from(media.data)).toEqual([1, 2, 3]);
    expect(await ig.lookupProfile!({ credentials, userId: '9001' })).toEqual({
      displayName: 'Chioma Obi',
    });
    expect(seen.at(-1)).toMatchObject({
      path: '/v26.0/9001?fields=name,username',
      auth: 'Bearer IGtoken',
    });
    respond = () => ({ status: 400, body: { error: { message: 'no', code: 100 } } });
    expect(await ig.lookupProfile!({ credentials, userId: '9001' })).toBeNull();
  });
});
