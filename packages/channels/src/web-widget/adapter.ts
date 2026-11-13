import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../types';

/**
 * Website chat (W1): there is no platform to call. Visitors' messages come through our own
 * widget API (Core `sendWidgetMessage`), and replies are saved for the widget to fetch, so
 * "sending" only gives the message an id. See docs/decisions/0017.
 */
export const webChatAdapter: ChannelAdapter = {
  channel: 'web',
  capabilities: { images: true, buttons: false, lists: false },
  verifyWebhook: () => false,
  parseWebhook: () => ({ messages: [], statuses: [] }),
  send: async () => ({ externalId: `web-out:${randomUUID()}` }),
};
