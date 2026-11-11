/** The adapter interface and helpers shared by every channel. */
import type { InboundMessageInput, OutboundMessage } from '@fulcra/core';
import type { Channel } from '@fulcra/core/rules';

/** A delivery update from the platform (sent → delivered → read, or failed). */
export type MessageStatusUpdate = {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
  /** What the platform charges for this message, when it says (WhatsApp does). */
  pricing?: { billable: boolean; category: string };
};

/** What a webhook contained, already in our standard shapes. */
export type ParsedWebhook = {
  messages: { accountId: string; message: InboundMessageInput }[];
  statuses: { accountId: string; update: MessageStatusUpdate }[];
  /** Template reviews (approved, rejected…), for platforms with templates. */
  templates?: TemplateStatusUpdate[];
};

/** Meta's decision on a message template. */
export type TemplateStatusUpdate = {
  /** The business account the template belongs to (WhatsApp Business Account id). */
  businessAccountId: string;
  externalId?: string;
  name?: string;
  language?: string;
  status: string;
  reason?: string | null;
};

export type SendParams = {
  /** The platform account sending (e.g. WhatsApp phone number id). */
  accountId: string;
  /** Decrypted secrets of the connection (access token…). */
  credentials: string | null;
  /** The customer on the platform. */
  to: string;
  message: OutboundMessage;
};

export interface ChannelAdapter {
  readonly channel: Channel;
  /** What the platform can show; the agent falls back to plain text when it can't. */
  readonly capabilities: { images: boolean; buttons: boolean; lists: boolean };
  /** Checks the webhook really comes from the platform (signature header). */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Converts a verified webhook body into standard messages and status updates. */
  parseWebhook(body: unknown): ParsedWebhook;
  /** Sends one message; returns the platform's message id. Throws ChannelSendError. */
  send(params: SendParams): Promise<{ externalId: string }>;
  /** Shows the customer their message was seen, with "typing…" while a reply is written. */
  markRead?(params: {
    accountId: string;
    credentials: string | null;
    externalMessageId: string;
    typing: boolean;
  }): Promise<void>;
  /** The customer's name, for platforms whose webhooks don't include it (Instagram). */
  lookupProfile?(params: {
    credentials: string | null;
    userId: string;
  }): Promise<{ displayName: string } | null>;
  /** Downloads a photo or file the customer sent (platform media id, or its link). */
  downloadMedia?(params: {
    credentials: string | null;
    mediaId: string;
  }): Promise<{ data: Uint8Array; mimeType: string }>;
}

/** A message could not be sent. `retry: false` for permanent problems (e.g. bad number). */
export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    /** The connection itself is broken (e.g. token expired): the owner must reconnect. */
    readonly connectionBroken = false,
  ) {
    super(message);
    this.name = 'ChannelSendError';
  }
}

/**
 * Plain-text version of a message, for channels without buttons or lists (and for the
 * test chat): buttons and rows become a numbered list the customer can answer.
 */
export function toPlainText(message: OutboundMessage): string {
  switch (message.type) {
    case 'text':
      return message.text;
    case 'image':
      return message.caption ?? '';
    case 'template':
      return message.text;
    case 'buttons':
      return [message.text, '', ...message.buttons.map((b, i) => `${i + 1}. ${b.title}`)].join(
        '\n',
      );
    case 'list':
      return [
        message.text,
        '',
        ...message.rows.map(
          (r, i) => `${i + 1}. ${r.title}${r.description ? ` – ${r.description}` : ''}`,
        ),
      ].join('\n');
  }
}
