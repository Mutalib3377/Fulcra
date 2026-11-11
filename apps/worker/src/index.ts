import { APP_NAME } from '@fulcra/config';
import {
  enqueueSubmitPlatformTemplates,
  ensurePlatformTemplates,
  ensureQueues,
  JOBS,
  platformWhatsApp,
} from '@fulcra/core';
import { handleAgentReply } from './jobs/agent-reply';
import { handleCatalogImport } from './jobs/catalog-import';
import { handleChannelWebhook, handleMessageStatus } from './jobs/channel-webhook';
import { handleOwnerAlerts, handleSubmitPlatformTemplates } from './jobs/owner-alerts';
import { handleRefreshChannelTokens } from './jobs/refresh-tokens';
import { handleCustomerNotifications, handleSubmitTemplates } from './jobs/templates';
import { handleInboundMessage, handleSendMessage } from './jobs/messages';
import { handlePaystackWebhook } from './jobs/paystack-webhook';
import { handleShopifyWebhook } from './jobs/shopify-webhook';
import { loadEnv } from './env';
import { createQueue } from './queue';

async function main(): Promise<void> {
  const env = loadEnv();
  const boss = createQueue(env.DATABASE_URL);

  await boss.start();
  await ensureQueues(boss);
  // Job handlers, one per queue (more arrive with later phases: agent replies, imports…).
  await boss.work(JOBS.paystackWebhook.name, { localConcurrency: 2 }, handlePaystackWebhook);
  // Imports download photos one by one; one at a time keeps memory low on a small server.
  await boss.work(JOBS.catalogImport.name, { localConcurrency: 1 }, handleCatalogImport);
  await boss.work(JOBS.shopifyWebhook.name, { localConcurrency: 1 }, handleShopifyWebhook);
  await boss.work(JOBS.inboundMessage.name, { localConcurrency: 4 }, handleInboundMessage);
  await boss.work(JOBS.sendMessage.name, { localConcurrency: 4 }, handleSendMessage);
  await boss.work(JOBS.agentReply.name, { localConcurrency: 4 }, handleAgentReply);
  await boss.work(JOBS.channelWebhook.name, { localConcurrency: 2 }, handleChannelWebhook);
  await boss.work(JOBS.messageStatus.name, { localConcurrency: 4 }, handleMessageStatus);
  await boss.work(JOBS.submitTemplates.name, { localConcurrency: 1 }, handleSubmitTemplates);
  await boss.work(JOBS.customerNotifications.name, { localConcurrency: 1 }, () =>
    handleCustomerNotifications(),
  );
  await boss.work(JOBS.ownerAlerts.name, { localConcurrency: 1 }, () => handleOwnerAlerts());
  await boss.work(JOBS.submitPlatformTemplates.name, { localConcurrency: 1 }, () =>
    handleSubmitPlatformTemplates(),
  );
  await boss.schedule(JOBS.ownerAlerts.name, '* * * * *', {}, { singletonKey: 'tick' });
  await boss.work(JOBS.refreshChannelTokens.name, { localConcurrency: 1 }, () =>
    handleRefreshChannelTokens(),
  );
  // Instagram tokens last 60 days; checked once a day (UTC).
  await boss.schedule(JOBS.refreshChannelTokens.name, '23 3 * * *', {}, { singletonKey: 'daily' });
  // Fulcra's own alert templates go to Meta once (missing ones only).
  await ensurePlatformTemplates();
  if (platformWhatsApp()) await enqueueSubmitPlatformTemplates();
  // Receipts and order updates on WhatsApp, checked every minute.
  await boss.schedule(JOBS.customerNotifications.name, '* * * * *', {}, { singletonKey: 'tick' });
  console.info(`[worker] ${APP_NAME} worker ready`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.info(`[worker] ${signal} received, stopping`);
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exit(1);
});
