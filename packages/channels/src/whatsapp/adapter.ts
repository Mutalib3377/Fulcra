import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundMessageInput, OutboundMessage } from '@fulcra/core';
import { z } from 'zod';
import {
  ChannelSendError,
  type ChannelAdapter,
  type MessageStatusUpdate,
  type ParsedWebhook,
  type SendParams,
} from '../types';

/**
 * WhatsApp Business Platform (Cloud API) adapter: webhooks in, messages out, photos and
 * read receipts. Plain fetch against the Graph API (no SDK). See docs/decisions/0013.
 */

/** Graph API address and version. Tests point WHATSAPP_GRAPH_URL at a fake server. */
function graph(env: NodeJS.ProcessEnv = process.env) {
  const base = (env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  const version = env.WHATSAPP_GRAPH_VERSION || 'v26.0';
  return `${base}/${version}`;
}

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

// ─── Signature ───────────────────────────────────────────────────────────────

/** Meta signs every webhook with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export function verifyWhatsAppSignature(
  rawBody: string,
  header: string | null,
  appSecret: string | undefined,
): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ─── Webhook parsing ─────────────────────────────────────────────────────────

const metaError = z.object({
  code: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
});

const webhookSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z
                .object({
                  metadata: z.object({ phone_number_id: z.string() }).optional(),
                  contacts: z
                    .array(
                      z.object({
                        wa_id: z.string(),
                        profile: z.object({ name: z.string().optional() }).optional(),
                      }),
                    )
                    .optional(),
                  messages: z.array(z.record(z.string(), z.unknown())).optional(),
                  statuses: z
                    .array(
                      z.object({
                        id: z.string(),
                        status: z.string(),
                        pricing: z
                          .object({ billable: z.boolean().optional(), category: z.string() })
                          .optional(),
                        errors: z.array(metaError).optional(),
                      }),
                    )
                    .optional(),
                })
                .loose(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

/** Plain words for the delivery errors sellers will actually see. */
const DELIVERY_ERRORS: Record<number, string> = {
  131047:
    'Not delivered: more than 24 hours have passed since the customer last wrote. Wait for them to write again.',
  131026:
    "Not delivered: this number can't receive WhatsApp messages (no WhatsApp, or an old app).",
  131049: 'Not delivered: WhatsApp held back this message to protect the customer experience.',
  131051: 'Not delivered: this kind of message is not supported.',
  131053: 'Not delivered: the photo or file could not be sent.',
  130472: 'Not delivered: this customer is part of a WhatsApp test and cannot receive it.',
  131050: 'Not delivered: the customer has stopped marketing messages from you.',
};

export function deliveryErrorMessage(error: z.infer<typeof metaError> | undefined): string {
  if (error?.code && DELIVERY_ERRORS[error.code]) return DELIVERY_ERRORS[error.code]!;
  return 'Not delivered by WhatsApp. Try again, or contact the customer another way.';
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** One WhatsApp message in our standard shape (null for things that are not messages). */
function toInbound(
  raw: Record<string, unknown>,
  names: Map<string, string>,
): InboundMessageInput | null {
  const id = str(raw.id);
  const from = str(raw.from);
  if (!id || !from) return null;
  const seconds = Number(str(raw.timestamp) ?? NaN);
  const base = {
    externalId: id,
    from: { externalUserId: from, displayName: (names.get(from) ?? '').slice(0, 120) },
    sentAt: Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(),
  };
  const type = str(raw.type);
  const media = (kind: 'image' | 'audio' | 'video' | 'document') => {
    const m = obj(raw[kind]);
    return {
      ...base,
      type: kind,
      text: '',
      media: {
        providerMediaId: str(m.id),
        mimeType: str(m.mime_type),
        caption: str(m.caption)?.slice(0, 1024),
      },
    };
  };
  switch (type) {
    case 'text':
      return { ...base, type: 'text', text: (str(obj(raw.text).body) ?? '').slice(0, 4096) };
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
      return media(type);
    case 'location': {
      const l = obj(raw.location);
      const latitude = Number(l.latitude);
      const longitude = Number(l.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return { ...base, type: 'unsupported', text: '' };
      const name = [str(l.name), str(l.address)].filter(Boolean).join(', ');
      return {
        ...base,
        type: 'location',
        text: name.slice(0, 4096),
        location: { latitude, longitude, ...(name ? { name: name.slice(0, 200) } : {}) },
      };
    }
    case 'interactive': {
      const i = obj(raw.interactive);
      const reply = obj(i.button_reply ?? i.list_reply);
      return {
        ...base,
        type: 'button_reply',
        text: (str(reply.title) ?? '').slice(0, 4096),
        replyId: str(reply.id)?.slice(0, 200),
      };
    }
    case 'button': {
      const b = obj(raw.button);
      return {
        ...base,
        type: 'button_reply',
        text: (str(b.text) ?? '').slice(0, 4096),
        replyId: str(b.payload)?.slice(0, 200),
      };
    }
    case 'reaction':
      return null; // an emoji on an earlier message: nothing to answer
    default:
      return { ...base, type: 'unsupported', text: '' };
  }
}

function parseWebhook(body: unknown): ParsedWebhook {
  const parsed = webhookSchema.safeParse(body);
  const result: ParsedWebhook = { messages: [], statuses: [] };
  if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') return result;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const accountId = value.metadata?.phone_number_id;
      if (!accountId) continue;
      const names = new Map(
        (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? ''] as const),
      );
      for (const raw of value.messages ?? []) {
        const message = toInbound(raw, names);
        if (message) result.messages.push({ accountId, message });
      }
      for (const s of value.statuses ?? []) {
        if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        const update: MessageStatusUpdate = {
          externalId: s.id,
          status: s.status as MessageStatusUpdate['status'],
          ...(s.status === 'failed' ? { error: deliveryErrorMessage(s.errors?.[0]) } : {}),
          ...(s.pricing
            ? { pricing: { billable: s.pricing.billable ?? false, category: s.pricing.category } }
            : {}),
        };
        result.statuses.push({ accountId, update });
      }
    }
  }
  return result;
}

// ─── Graph API calls ─────────────────────────────────────────────────────────

/** An error answer from Meta's API. */
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | undefined,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

function accessToken(credentials: string | null): string {
  try {
    const token = obj(JSON.parse(credentials ?? '')).accessToken;
    if (typeof token === 'string' && token) return token;
  } catch {
    // fall through
  }
  throw new ChannelSendError('This WhatsApp number needs to be connected again.', false, true);
}

async function call(
  path: string,
  token: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${graph()}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WhatsAppApiError('Could not reach WhatsApp.', 0, undefined);
  }
  const data = obj(await response.json().catch(() => ({})));
  if (!response.ok) {
    const error = obj(data.error);
    throw new WhatsAppApiError(
      str(error.message) ?? `WhatsApp answered ${response.status}`,
      response.status,
      typeof error.code === 'number' ? error.code : undefined,
    );
  }
  return data;
}

/** Meta error codes: token problems, rate limits, the 24-hour window, bad numbers. */
const TOKEN_CODES = new Set([190, 102, 10, 200]);
const RATE_CODES = new Set([4, 80007, 130429, 131048, 131056]);

function toSendError(error: unknown): ChannelSendError {
  if (error instanceof ChannelSendError) return error;
  if (!(error instanceof WhatsAppApiError)) return new ChannelSendError('Could not send.', true);
  if (error.code !== undefined && TOKEN_CODES.has(error.code))
    return new ChannelSendError(
      'WhatsApp refused our access. Reconnect your WhatsApp number in Settings.',
      false,
      true,
    );
  if (error.code !== undefined && RATE_CODES.has(error.code))
    return new ChannelSendError('WhatsApp asked us to slow down.', true);
  if (error.code === 131047) return new ChannelSendError(DELIVERY_ERRORS[131047]!, false);
  if (error.code === 131026 || error.code === 131030)
    return new ChannelSendError(DELIVERY_ERRORS[131026]!, false);
  if (error.status === 0 || error.status >= 500)
    return new ChannelSendError('WhatsApp is not answering right now.', true);
  return new ChannelSendError('WhatsApp could not send this message.', false);
}

function sendBody(to: string, message: OutboundMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (message.type) {
    case 'text':
      return { ...base, type: 'text', text: { body: message.text, preview_url: true } };
    case 'image':
      return {
        ...base,
        type: 'image',
        image: { link: message.imageUrl, ...(message.caption ? { caption: message.caption } : {}) },
      };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.text },
          action: {
            buttons: message.buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.text },
          action: {
            button: message.buttonLabel,
            sections: [
              {
                title: 'Options',
                rows: message.rows.map((r) => ({
                  id: r.id,
                  title: r.title,
                  ...(r.description ? { description: r.description } : {}),
                })),
              },
            ],
          },
        },
      };
  }
}

async function send(params: SendParams): Promise<{ externalId: string }> {
  const token = accessToken(params.credentials);
  try {
    const data = await call(`${params.accountId}/messages`, token, {
      method: 'POST',
      body: sendBody(params.to, params.message),
    });
    const id = str(obj((data.messages as unknown[] | undefined)?.[0]).id);
    if (!id) throw new WhatsAppApiError('WhatsApp gave no message id.', 502, undefined);
    return { externalId: id };
  } catch (error) {
    throw toSendError(error);
  }
}

async function markRead(params: {
  accountId: string;
  credentials: string | null;
  externalMessageId: string;
  typing: boolean;
}): Promise<void> {
  await call(`${params.accountId}/messages`, accessToken(params.credentials), {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: params.externalMessageId,
      ...(params.typing ? { typing_indicator: { type: 'text' } } : {}),
    },
  });
}

async function downloadMedia(params: {
  credentials: string | null;
  mediaId: string;
}): Promise<{ data: Uint8Array; mimeType: string }> {
  const token = accessToken(params.credentials);
  const info = await call(encodeURIComponent(params.mediaId), token);
  const url = str(info.url);
  if (!url) throw new WhatsAppApiError('WhatsApp gave no media address.', 502, undefined);
  if (Number(info.file_size ?? 0) > MAX_MEDIA_BYTES)
    throw new WhatsAppApiError('The file is too large.', 413, undefined);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS * 2),
  });
  if (!response.ok)
    throw new WhatsAppApiError(
      `Media download failed (${response.status})`,
      response.status,
      undefined,
    );
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAX_MEDIA_BYTES)
    throw new WhatsAppApiError('The file is too large.', 413, undefined);
  return { data, mimeType: str(info.mime_type) ?? response.headers.get('content-type') ?? '' };
}

/**
 * Checks a phone number id and token with Meta before saving a connection. Returns how
 * WhatsApp shows the number. Throws WhatsAppApiError when Meta refuses.
 */
export async function lookupWhatsAppNumber(
  phoneNumberId: string,
  token: string,
): Promise<{ displayPhoneNumber: string; verifiedName: string }> {
  const data = await call(
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    token,
  );
  return {
    displayPhoneNumber: str(data.display_phone_number) ?? '',
    verifiedName: str(data.verified_name) ?? '',
  };
}

/** Asks Meta to send this WhatsApp Business Account's webhooks to our app. */
export async function subscribeWhatsAppApp(
  businessAccountId: string,
  token: string,
): Promise<void> {
  await call(`${encodeURIComponent(businessAccountId)}/subscribed_apps`, token, { method: 'POST' });
}

export const whatsAppAdapter: ChannelAdapter = {
  channel: 'whatsapp',
  capabilities: { images: true, buttons: true, lists: true },
  verifyWebhook: (rawBody, headers) =>
    verifyWhatsAppSignature(
      rawBody,
      headers.get('x-hub-signature-256'),
      process.env.META_APP_SECRET,
    ),
  parseWebhook,
  send,
  markRead,
  downloadMedia,
};
