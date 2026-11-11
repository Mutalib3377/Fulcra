import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundMessageInput, OutboundMessage } from '@fulcra/core';
import { z } from 'zod';
import {
  ChannelSendError,
  toPlainText,
  type ChannelAdapter,
  type MessageStatusUpdate,
  type ParsedWebhook,
  type SendParams,
} from '../types';

/**
 * Instagram adapter (Instagram API with Instagram Login): DMs in, replies out, photos and
 * names. Plain fetch, no SDK. Instagram has no templates: outside the 24-hour window
 * nothing can be sent (Core's reply window). See docs/decisions/0016.
 */

const VERSION = () =>
  process.env.INSTAGRAM_GRAPH_VERSION || process.env.WHATSAPP_GRAPH_VERSION || 'v26.0';

/**
 * Instagram's three hosts. Tests and local runs can send them all to one fake server with
 * INSTAGRAM_TEST_BASE_URL (ignored in production).
 */
function hosts(env: NodeJS.ProcessEnv = process.env) {
  const fake = env.NODE_ENV !== 'production' ? env.INSTAGRAM_TEST_BASE_URL?.replace(/\/$/, '') : '';
  return fake
    ? { authorize: `${fake}/oauth/authorize`, api: fake, graph: fake }
    : {
        authorize: 'https://www.instagram.com/oauth/authorize',
        api: 'https://api.instagram.com',
        graph: 'https://graph.instagram.com',
      };
}

const TIMEOUT_MS = 15_000;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export type InstagramAppConfig = { appId: string; appSecret: string };

export function getInstagramAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): InstagramAppConfig | null {
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

/** Instagram signs webhooks with the Instagram app secret (X-Hub-Signature-256). */
export function verifyInstagramSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ─── Login and tokens ────────────────────────────────────────────────────────

const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];

/** Where to send the seller to log in with Instagram and allow messaging. */
export function instagramAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(hosts().authorize);
  url.searchParams.set('client_id', params.appId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('state', params.state);
  return url.toString();
}

/** An error answer from Instagram's API. */
export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = 'InstagramApiError';
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

async function request(
  url: string,
  init: { method?: 'GET' | 'POST'; token?: string; body?: unknown; form?: URLSearchParams } = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new InstagramApiError('Could not reach Instagram.', 0, undefined);
  }
  const data = obj(await response.json().catch(() => ({})));
  if (!response.ok) {
    const error = obj(data.error);
    throw new InstagramApiError(
      str(error.message) ?? str(data.error_message) ?? `Instagram answered ${response.status}`,
      response.status,
      typeof error.code === 'number'
        ? error.code
        : typeof data.code === 'number'
          ? data.code
          : undefined,
      typeof error.error_subcode === 'number' ? error.error_subcode : undefined,
    );
  }
  return data;
}

export type InstagramToken = { accessToken: string; expiresAt: Date };

/**
 * Completes "Connect Instagram": the one-time code becomes a short-lived token, then a
 * long-lived one (60 days). Returns the token with the account's id and username.
 */
export async function exchangeInstagramCode(params: {
  code: string;
  redirectUri: string;
  config: InstagramAppConfig;
  now?: Date;
}): Promise<InstagramToken & { accountId: string; username: string; name: string }> {
  const h = hosts();
  const short = await request(`${h.api}/oauth/access_token`, {
    method: 'POST',
    form: new URLSearchParams({
      client_id: params.config.appId,
      client_secret: params.config.appSecret,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
      code: params.code.replace(/#_$/, ''),
    }),
  });
  const shortToken = str(short.access_token);
  if (!shortToken) throw new InstagramApiError('Instagram gave no access token.', 502, undefined);
  const long = await request(
    `${h.graph}/access_token?${new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: params.config.appSecret,
      access_token: shortToken,
    }).toString()}`,
  );
  const token = toToken(long, params.now);
  const me = await request(`${h.graph}/${VERSION()}/me?fields=user_id,username,name`, {
    token: token.accessToken,
  });
  const accountId =
    str(me.user_id) ?? (typeof me.user_id === 'number' ? String(me.user_id) : undefined);
  if (!accountId) throw new InstagramApiError('Instagram gave no account id.', 502, undefined);
  return { ...token, accountId, username: str(me.username) ?? '', name: str(me.name) ?? '' };
}

function toToken(data: Record<string, unknown>, now = new Date()): InstagramToken {
  const accessToken = str(data.access_token);
  const seconds = Number(data.expires_in ?? 0);
  if (!accessToken) throw new InstagramApiError('Instagram gave no access token.', 502, undefined);
  return {
    accessToken,
    expiresAt: new Date(now.getTime() + (seconds > 0 ? seconds : 60 * 86_400) * 1000),
  };
}

/** Renews a long-lived token for another 60 days (it must be at least a day old). */
export async function refreshInstagramToken(
  token: string,
  now = new Date(),
): Promise<InstagramToken> {
  const data = await request(
    `${hosts().graph}/refresh_access_token?${new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: token,
    }).toString()}`,
  );
  return toToken(data, now);
}

/** Asks Instagram to send this account's DMs to our webhook. */
export async function subscribeInstagramApp(token: string): Promise<void> {
  await request(
    `${hosts().graph}/${VERSION()}/me/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_seen`,
    { method: 'POST', token },
  );
}

// ─── Webhook parsing ─────────────────────────────────────────────────────────

const webhookSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]).transform(String),
        messaging: z.array(z.record(z.string(), z.unknown())).default([]),
      }),
    )
    .default([]),
});

const ATTACHMENT_TYPES: Record<string, InboundMessageInput['type']> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'document',
};

function toInbound(event: Record<string, unknown>): InboundMessageInput | null {
  const sender = str(obj(event.sender).id) ?? String(obj(event.sender).id ?? '');
  const ms = Number(event.timestamp ?? NaN);
  const sentAt = Number.isFinite(ms) ? new Date(ms) : new Date();
  const base = { from: { externalUserId: sender, displayName: '' }, sentAt };
  if (!sender) return null;

  const postback = obj(event.postback);
  if (str(postback.mid)) {
    return {
      ...base,
      externalId: str(postback.mid)!,
      type: 'button_reply',
      text: (str(postback.title) ?? '').slice(0, 4096),
      replyId: str(postback.payload)?.slice(0, 200),
    };
  }
  const message = obj(event.message);
  const mid = str(message.mid);
  // Echoes are our own sends coming back; deleted messages have nothing to answer.
  if (!mid || message.is_echo || message.is_deleted) return null;
  if (message.is_unsupported) return { ...base, externalId: mid, type: 'unsupported', text: '' };
  const text = (str(message.text) ?? '').slice(0, 4096);
  const quick = obj(message.quick_reply);
  if (str(quick.payload))
    return {
      ...base,
      externalId: mid,
      type: 'button_reply',
      text,
      replyId: str(quick.payload)!.slice(0, 200),
    };

  const story = obj(obj(message.reply_to).story);
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(obj) : [];
  const first = attachments[0];
  if (first) {
    const kind = ATTACHMENT_TYPES[str(first.type) ?? ''];
    const url = str(obj(first.payload).url);
    if (kind && url) {
      return {
        ...base,
        externalId: mid,
        type: kind,
        text: '',
        // Instagram gives a temporary link instead of a media id; the worker downloads it.
        media: { url: url.slice(0, 2048), ...(text ? { caption: text.slice(0, 1024) } : {}) },
      };
    }
    // Shared posts, reels, story mentions…: nothing we can read yet.
    return { ...base, externalId: mid, type: 'unsupported', text };
  }
  if (!text) return null;
  return {
    ...base,
    externalId: mid,
    type: 'text',
    text: str(story.id) ? `[Replying to your story] ${text}`.slice(0, 4096) : text,
  };
}

function parseWebhook(body: unknown): ParsedWebhook {
  const parsed = webhookSchema.safeParse(body);
  const result: ParsedWebhook = { messages: [], statuses: [] };
  if (!parsed.success || parsed.data.object !== 'instagram') return result;
  for (const entry of parsed.data.entry) {
    for (const event of entry.messaging) {
      // Our account is the recipient of customer messages.
      const recipient = String(obj(event.recipient).id ?? '');
      if (recipient && recipient !== entry.id) continue;
      const read = obj(event.read);
      if (str(read.mid)) {
        const update: MessageStatusUpdate = { externalId: str(read.mid)!, status: 'read' };
        result.statuses.push({ accountId: entry.id, update });
        continue;
      }
      const message = toInbound(event);
      if (message) result.messages.push({ accountId: entry.id, message });
    }
  }
  return result;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function accessToken(credentials: string | null): string {
  try {
    const token = obj(JSON.parse(credentials ?? '')).accessToken;
    if (typeof token === 'string' && token) return token;
  } catch {
    // fall through
  }
  throw new ChannelSendError('This Instagram account needs to be connected again.', false, true);
}

function messageBody(message: OutboundMessage): Record<string, unknown> {
  switch (message.type) {
    case 'image':
      return { attachment: { type: 'image', payload: { url: message.imageUrl } } };
    case 'buttons':
      return {
        text: message.text,
        quick_replies: message.buttons.map((b) => ({
          content_type: 'text',
          title: b.title,
          payload: b.id,
        })),
      };
    case 'list':
      // Up to 13 quick replies on Instagram; long lists become numbered text.
      return message.rows.length <= 13
        ? {
            text: message.text,
            quick_replies: message.rows.map((r) => ({
              content_type: 'text',
              title: r.title,
              payload: r.id,
            })),
          }
        : { text: toPlainText(message) };
    default:
      return { text: toPlainText(message).slice(0, 1000) };
  }
}

/** Instagram error codes: token problems, the 24-hour window, rate limits. */
function toSendError(error: unknown): ChannelSendError {
  if (error instanceof ChannelSendError) return error;
  if (!(error instanceof InstagramApiError)) return new ChannelSendError('Could not send.', true);
  if (error.code === 190 || error.code === 102)
    return new ChannelSendError(
      'Instagram refused our access. Reconnect your Instagram account in Settings.',
      false,
      true,
    );
  if (error.code === 10 && error.subcode === 2534022)
    return new ChannelSendError(
      'Not sent: more than 24 hours have passed since the customer last wrote. Wait for them to write again.',
      false,
    );
  if (error.code === 4 || error.code === 613 || error.code === 32)
    return new ChannelSendError('Instagram asked us to slow down.', true);
  if (error.status === 0 || error.status >= 500)
    return new ChannelSendError('Instagram is not answering right now.', true);
  return new ChannelSendError('Instagram could not send this message.', false);
}

async function send(params: SendParams): Promise<{ externalId: string }> {
  const token = accessToken(params.credentials);
  try {
    const data = await request(
      `${hosts().graph}/${VERSION()}/${encodeURIComponent(params.accountId)}/messages`,
      {
        method: 'POST',
        token,
        body: { recipient: { id: params.to }, message: messageBody(params.message) },
      },
    );
    const id = str(data.message_id);
    if (!id) throw new InstagramApiError('Instagram gave no message id.', 502, undefined);
    return { externalId: id };
  } catch (error) {
    throw toSendError(error);
  }
}

/** Downloads a customer's photo from Instagram's temporary link. */
async function downloadMedia(params: {
  credentials: string | null;
  mediaId: string;
}): Promise<{ data: Uint8Array; mimeType: string }> {
  const url = params.mediaId;
  if (!/^https?:\/\//.test(url)) throw new InstagramApiError('Not a media link.', 400, undefined);
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS * 2) });
  if (!response.ok)
    throw new InstagramApiError(
      `Media download failed (${response.status})`,
      response.status,
      undefined,
    );
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAX_MEDIA_BYTES)
    throw new InstagramApiError('The file is too large.', 413, undefined);
  return { data, mimeType: response.headers.get('content-type') ?? '' };
}

/** The customer's name as Instagram shows it (best effort; may be refused). */
async function lookupProfile(params: {
  credentials: string | null;
  userId: string;
}): Promise<{ displayName: string } | null> {
  try {
    const data = await request(
      `${hosts().graph}/${VERSION()}/${encodeURIComponent(params.userId)}?fields=name,username`,
      { token: accessToken(params.credentials) },
    );
    const name = str(data.name) || (str(data.username) ? `@${str(data.username)}` : '');
    return name ? { displayName: name.slice(0, 120) } : null;
  } catch {
    return null;
  }
}

export const instagramAdapter: ChannelAdapter = {
  channel: 'instagram',
  capabilities: { images: true, buttons: true, lists: true },
  verifyWebhook: (rawBody, headers) =>
    verifyInstagramSignature(
      rawBody,
      headers.get('x-hub-signature-256'),
      process.env.INSTAGRAM_APP_SECRET,
    ),
  parseWebhook,
  send,
  downloadMedia,
  lookupProfile,
};
