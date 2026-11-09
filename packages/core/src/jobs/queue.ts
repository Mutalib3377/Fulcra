import { getDatabaseUrl } from '@fulcra/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

/**
 * Background jobs (pg-boss on our Postgres). Job names and payloads are defined here so the
 * web app (sender) and the worker (handler) agree. Slow work goes here (rule 8).
 */
export const JOBS = {
  /** Process a saved Paystack webhook: confirm payment, mark order paid. */
  paystackWebhook: {
    name: 'paystack-webhook',
    data: z.object({ webhookEventId: z.uuid() }),
  },
  /** Act on a saved Shopify app webhook (app removed, privacy requests). */
  shopifyWebhook: {
    name: 'shopify-webhook',
    data: z.object({ webhookEventId: z.uuid() }),
  },
  /** Store an incoming message (find the customer and chat, route to the assistant or the team). */
  inboundMessage: {
    name: 'inbound-message',
    data: z.object({
      businessId: z.uuid(),
      connectionId: z.uuid(),
      message: z.record(z.string(), z.unknown()),
    }),
  },
  /** Let the assistant answer a chat (after a short wait, so quick messages get one reply). */
  agentReply: {
    name: 'agent-reply',
    data: z.object({ businessId: z.uuid(), conversationId: z.uuid(), messageId: z.uuid() }),
  },
  /** Send a queued outgoing message through its channel. */
  sendMessage: {
    name: 'send-message',
    data: z.object({ businessId: z.uuid(), messageId: z.uuid() }),
  },
  /** Save the approved products of a catalog import (photos, products, stock). */
  catalogImport: {
    name: 'catalog-import',
    data: z.object({ businessId: z.uuid(), importId: z.uuid() }),
  },
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS]['name'];

let sender: Promise<PgBoss> | undefined;

/** A queue client for sending jobs only (the web app). The worker runs its own. */
function getSender(): Promise<PgBoss> {
  sender ??= (async () => {
    const boss = new PgBoss({
      connectionString: getDatabaseUrl(),
      schema: 'pgboss',
      application_name: 'fulcra-web',
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on('error', (error) => console.error('[queue] error', error));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })();
  sender.catch(() => {
    sender = undefined;
  });
  return sender;
}

/** Creates every queue we use (safe to call repeatedly). */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const job of Object.values(JOBS)) {
    if (!(await boss.getQueue(job.name))) await boss.createQueue(job.name);
  }
}

/** Retries with backoff: a webhook keeps trying for about an hour if Paystack or the DB hiccups. */
const RETRY = { retryLimit: 8, retryDelay: 15, retryBackoff: true } as const;

export async function enqueuePaystackWebhook(webhookEventId: string): Promise<void> {
  const data = JOBS.paystackWebhook.data.parse({ webhookEventId });
  const boss = await getSender();
  // singletonKey: the same webhook is never queued twice at once.
  await boss.send(JOBS.paystackWebhook.name, data, { ...RETRY, singletonKey: webhookEventId });
}

export async function enqueueCatalogImport(businessId: string, importId: string): Promise<void> {
  const data = JOBS.catalogImport.data.parse({ businessId, importId });
  const boss = await getSender();
  // A retry continues where the last run stopped (saved products are not saved again).
  await boss.send(JOBS.catalogImport.name, data, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    singletonKey: importId,
  });
}

export async function enqueueShopifyWebhook(webhookEventId: string): Promise<void> {
  const data = JOBS.shopifyWebhook.data.parse({ webhookEventId });
  const boss = await getSender();
  await boss.send(JOBS.shopifyWebhook.name, data, { ...RETRY, singletonKey: webhookEventId });
}

export async function enqueueInboundMessage(
  businessId: string,
  connectionId: string,
  message: Record<string, unknown>,
): Promise<void> {
  const data = JOBS.inboundMessage.data.parse({ businessId, connectionId, message });
  const boss = await getSender();
  await boss.send(JOBS.inboundMessage.name, data, RETRY);
}

export async function enqueueSendMessage(businessId: string, messageId: string): Promise<void> {
  const data = JOBS.sendMessage.data.parse({ businessId, messageId });
  const boss = await getSender();
  // singletonKey: a message is never sent twice at once.
  await boss.send(JOBS.sendMessage.name, data, {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    singletonKey: messageId,
  });
}

/** Seconds to wait before the assistant answers, so "Hi" + "how much?" get one reply. */
export const AGENT_REPLY_DELAY_SECONDS = 4;

/**
 * Queues the assistant's answer to a customer message. Every message queues a job; a job only
 * answers if its message is still the newest, so the last one answers everything at once.
 */
export async function enqueueAgentReply(
  businessId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const data = JOBS.agentReply.data.parse({ businessId, conversationId, messageId });
  const boss = await getSender();
  await boss.send(JOBS.agentReply.name, data, {
    startAfter: AGENT_REPLY_DELAY_SECONDS,
    singletonKey: messageId,
    retryLimit: 2,
    retryDelay: 10,
  });
}
