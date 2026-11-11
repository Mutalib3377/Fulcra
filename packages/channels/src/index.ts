/**
 * @fulcra/channels — one adapter per channel (whatsapp/ in A3, instagram/ in G1, web-widget/
 * in W1). Each converts platform messages to the standard InboundMessage and the agent's
 * OutboundMessage back to the platform format (rule 3). Adding a channel = adding an adapter.
 *
 * The message shapes live in Core (Core stores and sends them; packages import Core, never
 * the reverse) and are re-exported here.
 */
import type { Channel } from '@fulcra/core/rules';
import type { ChannelAdapter } from './types';
import { instagramAdapter } from './instagram/adapter';
import { whatsAppAdapter } from './whatsapp/adapter';

export {
  inboundMessage,
  outboundMessage,
  type InboundMessage,
  type InboundMessageInput,
  type OutboundMessage,
} from '@fulcra/core';

export * from './types';
export {
  InstagramApiError,
  exchangeInstagramCode,
  getInstagramAppConfig,
  instagramAdapter,
  instagramAuthorizeUrl,
  refreshInstagramToken,
  subscribeInstagramApp,
  verifyInstagramSignature,
  type InstagramAppConfig,
  type InstagramToken,
} from './instagram/adapter';
export {
  WhatsAppApiError,
  createWhatsAppTemplate,
  exchangeEmbeddedSignupCode,
  registerWhatsAppNumber,
  lookupWhatsAppNumber,
  subscribeWhatsAppApp,
  verifyWhatsAppSignature,
  whatsAppAdapter,
} from './whatsapp/adapter';

const adapters = new Map<Channel, ChannelAdapter>();

/** Registers an adapter (each channel's module does this once). */
export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function adapterFor(channel: Channel): ChannelAdapter | null {
  return adapters.get(channel) ?? null;
}

registerAdapter(whatsAppAdapter);
registerAdapter(instagramAdapter);
