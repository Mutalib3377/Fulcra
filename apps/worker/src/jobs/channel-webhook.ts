import { adapterFor, type InboundMessageInput } from '@fulcra/channels';
import {
  applyMessageStatus,
  applyOwnerAlertStatus,
  applyPlatformTemplateStatus,
  applyTemplateStatusUpdate,
  platformWhatsApp,
  claimChannelWebhook,
  enqueueInboundMessage,
  enqueueMessageStatus,
  findConnectionByAccount,
  JOBS,
  markChannelWebhookProcessed,
  messageStatusUpdate,
  recordWhatsAppUsage,
  storeImage,
} from '@fulcra/core';
import type { Job } from 'pg-boss';
import { z } from 'zod';

/**
 * Reads a saved channel webhook: each customer message is queued for the usual pipeline
 * (photos are downloaded and stored first, so the assistant can look at them), and each
 * delivery update is queued on its own (it may need a retry).
 */
export async function handleChannelWebhook(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { webhookEventId } = JOBS.channelWebhook.data.parse(job.data);
    const event = await claimChannelWebhook(webhookEventId);
    if (!event) continue;
    const adapter = adapterFor(event.channel);
    if (!adapter) {
      await markChannelWebhookProcessed(webhookEventId);
      continue;
    }
    try {
      const parsed = adapter.parseWebhook(event.payload);
      const platform = event.channel === 'whatsapp' ? platformWhatsApp() : null;
      for (const { accountId, message } of parsed.messages) {
        if (platform && accountId === platform.phoneNumberId) continue; // a reply to an alert
        const connection = await findConnectionByAccount(event.channel, accountId);
        if (!connection || connection.mode !== 'live') {
          console.warn(`[worker] message for an unknown ${event.channel} account ${accountId}`);
          continue;
        }
        const named = await addName(adapter, connection, message);
        const withPhoto = await attachPhoto(adapter, connection, named);
        await enqueueInboundMessage(connection.businessId, connection.id, withPhoto);
      }
      for (const { accountId, update } of parsed.statuses) {
        // Fulcra's own number: owner alerts and briefings.
        if (platform && accountId === platform.phoneNumberId) {
          await applyOwnerAlertStatus(update);
          continue;
        }
        const connection = await findConnectionByAccount(event.channel, accountId);
        if (!connection) continue;
        await enqueueMessageStatus(connection.businessId, update);
      }
      for (const update of parsed.templates ?? []) {
        await applyTemplateStatusUpdate(event.channel, update);
        await applyPlatformTemplateStatus(update);
      }
      await markChannelWebhookProcessed(webhookEventId);
      console.info(
        `[worker] ${event.channel} webhook: ${parsed.messages.length} message(s), ${parsed.statuses.length} update(s)`,
      );
    } catch (error) {
      await markChannelWebhookProcessed(
        webhookEventId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}

/** The customer's name when the webhook has none (Instagram). Best effort. */
async function addName(
  adapter: NonNullable<ReturnType<typeof adapterFor>>,
  connection: { credentials: string | null },
  message: InboundMessageInput,
): Promise<InboundMessageInput> {
  if (message.from.displayName || !adapter.lookupProfile) return message;
  const profile = await adapter.lookupProfile({
    credentials: connection.credentials,
    userId: message.from.externalUserId,
  });
  return profile
    ? { ...message, from: { ...message.from, displayName: profile.displayName } }
    : message;
}

/** Downloads and stores a customer's photo. Without it, the message still arrives. */
async function attachPhoto(
  adapter: NonNullable<ReturnType<typeof adapterFor>>,
  connection: { businessId: string; credentials: string | null },
  message: InboundMessageInput,
): Promise<InboundMessageInput> {
  const mediaId = message.media?.providerMediaId ?? message.media?.url;
  if (message.type !== 'image' || !mediaId || !adapter.downloadMedia) return message;
  try {
    const file = await adapter.downloadMedia({ credentials: connection.credentials, mediaId });
    const image = await storeImage(connection.businessId, file.data);
    return { ...message, media: { ...message.media, image } };
  } catch (error) {
    console.warn('[worker] could not store a customer photo', error);
    return message;
  }
}

const pricedUpdate = messageStatusUpdate.extend({
  pricing: z.object({ billable: z.boolean(), category: z.string().min(1) }).optional(),
});

/**
 * A delivery update: what the platform charges is logged first (once per message, rule 12),
 * then the ticks move. Unknown messages are retried: "sent" can beat our own save.
 */
export async function handleMessageStatus(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, update } = JOBS.messageStatus.data.parse(job.data);
    const data = pricedUpdate.parse(update);
    if (data.pricing?.billable) {
      await recordWhatsAppUsage(businessId, {
        reference: data.externalId,
        category: data.pricing.category,
      });
    }
    const result = await applyMessageStatus(businessId, data);
    if (result === 'not_found') throw new Error(`message ${data.externalId} not saved yet`);
  }
}
