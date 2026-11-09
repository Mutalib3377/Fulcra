import {
  claimOutboundMessage,
  enqueueAgentReply,
  imageUrl,
  JOBS,
  markConnectionError,
  markMessageFailed,
  markMessageSent,
  receiveInboundMessage,
  type InboundMessageInput,
} from '@fulcra/core';
import { adapterFor, ChannelSendError, type OutboundMessage } from '@fulcra/channels';
import type { Job } from 'pg-boss';

/** Stores an incoming message and routes it: to the assistant (queued reply) or the team. */
export async function handleInboundMessage(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, connectionId, message } = JOBS.inboundMessage.data.parse(job.data);
    const result = await receiveInboundMessage(
      businessId,
      connectionId,
      message as InboundMessageInput,
    );
    // The assistant answers after a short wait (quick messages get one reply).
    if (result.status === 'saved' && result.route === 'agent') {
      await enqueueAgentReply(businessId, result.conversationId, result.messageId);
    }
    console.info(
      `[worker] inbound message: ${result.status}${result.status === 'saved' ? ` → ${result.route}` : ''}`,
    );
  }
}

/**
 * Sends a queued message through its channel. Test chats need no sending. A failure the
 * platform calls permanent is marked failed at once; others are retried by pg-boss.
 */
export async function handleSendMessage(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, messageId } = JOBS.sendMessage.data.parse(job.data);
    const delivery = await claimOutboundMessage(businessId, messageId);
    if (!delivery) continue;
    if (delivery.mode === 'test') {
      await markMessageSent(businessId, messageId, null);
      continue;
    }
    const adapter = adapterFor(delivery.channel);
    if (!adapter || !delivery.to) {
      await markMessageFailed(businessId, messageId, 'This channel is not connected yet.');
      continue;
    }
    try {
      const image = delivery.message.media?.image;
      const message: OutboundMessage = image
        ? {
            type: 'image',
            imageUrl: imageUrl(image, 'lg'),
            ...(delivery.message.text ? { caption: delivery.message.text.slice(0, 1024) } : {}),
          }
        : { type: 'text', text: delivery.message.text };
      const { externalId } = await adapter.send({
        accountId: delivery.externalAccountId,
        credentials: delivery.credentials,
        to: delivery.to,
        message,
      });
      await markMessageSent(businessId, messageId, externalId);
    } catch (error) {
      if (error instanceof ChannelSendError && !error.retry) {
        await markMessageFailed(businessId, messageId, error.message);
        // The owner sees why in Settings and must reconnect.
        if (error.connectionBroken)
          await markConnectionError(
            businessId,
            delivery.connectionId,
            'WhatsApp stopped accepting our access token (it may have expired or been removed).',
          );
        continue;
      }
      throw error;
    }
  }
}
