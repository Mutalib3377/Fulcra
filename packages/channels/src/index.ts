/**
 * @fulcra/channels — one adapter per channel (whatsapp/ in A3, instagram/ in G1, web-widget/
 * in W1). Each converts platform messages to the standard InboundMessage and the agent's
 * OutboundMessage back to the platform format (rule 3). Adding a channel = adding an adapter.
 *
 * The message shapes live in Core (Core stores and sends them; packages import Core, never
 * the reverse) and are re-exported here.
 */
import type { InboundMessageInput, OutboundMessage } from '@fulcra/core';
import type { Channel } from '@fulcra/core/rules';

export {
  inboundMessage,
  outboundMessage,
  type InboundMessage,
  type InboundMessageInput,
  type OutboundMessage,
} from '@fulcra/core';

/** A delivery update from the platform (sent → delivered → read, or failed). */
export type MessageStatusUpdate = {
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
};

/** What a webhook contained, already in our standard shapes. */
export type ParsedWebhook = {
  messages: { accountId: string; message: InboundMessageInput }[];
  statuses: { accountId: string; update: MessageStatusUpdate }[];
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
}

/** A message could not be sent. `retry: false` for permanent problems (e.g. bad number). */
export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
    this.name = 'ChannelSendError';
  }
}

const adapters = new Map<Channel, ChannelAdapter>();

/** Registers an adapter (each channel's module does this once). */
export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function adapterFor(channel: Channel): ChannelAdapter | null {
  return adapters.get(channel) ?? null;
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
