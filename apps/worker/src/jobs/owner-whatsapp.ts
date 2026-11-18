import { adapterFor, ChannelSendError, type InboundMessageInput } from '@fulcra/channels';
import {
  claimOwnerOutbound,
  consumeRateLimit,
  JOBS,
  markOwnerOutboundFailed,
  markOwnerOutboundSent,
  receiveOwnerWhatsAppMessage,
  storeImage,
  type PlatformWhatsApp,
} from '@fulcra/core';
import type { Job } from 'pg-boss';

const UNKNOWN_REPLY =
  "Hi, this is Fulcra 👋 This number isn't linked to a Fulcra business yet. To chat with your shop assistant here, add this number in Settings → Alerts on your Fulcra dashboard.";

const NOT_READABLE: Partial<Record<InboundMessageInput['type'], string>> = {
  audio:
    '[The owner sent a voice note. You cannot listen to voice notes yet: ask them to type it.]',
  video: '[The owner sent a video you cannot watch.]',
  document: '[The owner sent a file you cannot open.]',
  location: '[The owner shared a location.]',
  unsupported: '[The owner sent a message you cannot read.]',
};

/**
 * A message to Fulcra's own WhatsApp number: the owner talking to their assistant (O1b).
 * Photos are downloaded and stored for the owner's business; unknown numbers get one short
 * explanation a day.
 */
export async function handleOwnerWhatsAppMessage(
  platform: PlatformWhatsApp,
  message: InboundMessageInput,
): Promise<void> {
  const adapter = adapterFor('whatsapp')!;
  const mediaId = message.type === 'image' ? message.media?.providerMediaId : undefined;
  // A photo's words come as its caption.
  const text =
    message.text?.trim() || message.media?.caption?.trim() || NOT_READABLE[message.type] || '';
  const result = await receiveOwnerWhatsAppMessage(
    { fromPhone: message.from.externalUserId, externalId: message.externalId, text },
    {
      loadPhoto:
        mediaId && adapter.downloadMedia
          ? async (businessId) => {
              try {
                const file = await adapter.downloadMedia!({
                  credentials: platform.credentials,
                  mediaId,
                });
                return await storeImage(businessId, file.data);
              } catch (error) {
                console.warn('[worker] could not store an owner photo', error);
                return null;
              }
            }
          : undefined,
    },
  );
  if (result.status === 'saved') {
    // "Seen" and "typing…" on the owner's phone while the assistant works (best effort).
    await adapter
      .markRead?.({
        accountId: platform.phoneNumberId,
        credentials: platform.credentials,
        externalMessageId: message.externalId,
        typing: true,
      })
      .catch(() => {});
  }
  if (result.status === 'unknown') {
    const phone = message.from.externalUserId;
    if (!(await consumeRateLimit(`owner-unknown:${phone}`, 1, 24 * 3_600_000))) return;
    await adapter
      .send({
        accountId: platform.phoneNumberId,
        credentials: platform.credentials,
        to: phone,
        message: { type: 'text', text: UNKNOWN_REPLY },
      })
      .catch((error) => console.warn('[worker] could not answer an unknown number', error));
  }
  console.info(`[worker] owner WhatsApp message: ${result.status}`);
}

/** Sends an owner-chat reply from Fulcra's number. Retried until the reply is saved. */
export function makeOwnerWhatsAppSendHandler(platform: () => PlatformWhatsApp | null) {
  return async (jobs: Job<unknown>[]): Promise<void> => {
    for (const job of jobs) {
      const { businessId, messageId } = JOBS.ownerWhatsAppSend.data.parse(job.data);
      const outbound = await claimOwnerOutbound(businessId, messageId);
      if (outbound === 'missing') throw new Error(`owner reply ${messageId} not saved yet`);
      if (!outbound) continue;
      const number = platform();
      if (!number) {
        await markOwnerOutboundFailed(businessId, messageId);
        continue;
      }
      try {
        const { externalId } = await adapterFor('whatsapp')!.send({
          accountId: number.phoneNumberId,
          credentials: number.credentials,
          to: outbound.to,
          message: { type: 'text', text: outbound.text },
        });
        await markOwnerOutboundSent(businessId, messageId, externalId);
      } catch (error) {
        if (error instanceof ChannelSendError && !error.retry) {
          await markOwnerOutboundFailed(businessId, messageId);
          console.warn('[worker] owner reply not sent', error.message);
          continue;
        }
        throw error;
      }
    }
  };
}
