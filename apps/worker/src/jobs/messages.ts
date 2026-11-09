import {
  claimOutboundMessage,
  JOBS,
  markMessageFailed,
  markMessageSent,
  receiveInboundMessage,
  type InboundMessageInput,
} from '@fulcra/core';
import { adapterFor, ChannelSendError } from '@fulcra/channels';
import type { Job } from 'pg-boss';

/** Stores an incoming message and routes it (the assistant answers from A2). */
export async function handleInboundMessage(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, connectionId, message } = JOBS.inboundMessage.data.parse(job.data);
    const result = await receiveInboundMessage(
      businessId,
      connectionId,
      message as InboundMessageInput,
    );
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
      const { externalId } = await adapter.send({
        accountId: delivery.externalAccountId,
        credentials: delivery.credentials,
        to: delivery.to,
        message: { type: 'text', text: delivery.message.text },
      });
      await markMessageSent(businessId, messageId, externalId);
    } catch (error) {
      if (error instanceof ChannelSendError && !error.retry) {
        await markMessageFailed(businessId, messageId, error.message);
        continue;
      }
      throw error;
    }
  }
}
