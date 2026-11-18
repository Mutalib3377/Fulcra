import { APP_NAME } from '@fulcra/config';
import {
  enqueueSubmitPlatformTemplates,
  enqueueSyncBillingPlans,
  ensurePlatformTemplates,
  ensureQueues,
  JOBS,
  platformWhatsApp,
  syncBillingPlans,
} from '@fulcra/core';
import { handleAgentReply } from './jobs/agent-reply';
import { handleOwnerMessage } from './jobs/owner-message';
import { makeOwnerWhatsAppSendHandler } from './jobs/owner-whatsapp';
import { handleDatabaseBackup } from './jobs/backup';
import { handleCatalogImport } from './jobs/catalog-import';
import { handleChannelWebhook, handleMessageStatus } from './jobs/channel-webhook';
import { handleOwnerAlerts, handleSubmitPlatformTemplates } from './jobs/owner-alerts';
import { handleRefreshChannelTokens } from './jobs/refresh-tokens';
import { handleCustomerNotifications, handleSubmitTemplates } from './jobs/templates';
import { handleInboundMessage, handleSendMessage } from './jobs/messages';
import { handlePaymentClaims } from './jobs/payment-claims';
import { handlePaystackWebhook } from './jobs/paystack-webhook';
import { handleShopifyWebhook } from './jobs/shopify-webhook';
import { getQueueDatabaseUrl } from '@fulcra/db';
import { loadEnv } from './env';
import { initMonitoring, reported } from './monitoring';
import { createQueue } from './queue';

async function main(): Promise<void> {
  loadEnv(); // fails fast with a clear message if the environment is incomplete
  initMonitoring();
  const boss = createQueue(getQueueDatabaseUrl());

  await boss.start();
  await ensureQueues(boss);
  // Job handlers, one per queue (more arrive with later phases: agent replies, imports…).
  await boss.work(
    JOBS.paystackWebhook.name,
    { localConcurrency: 2 },
    reported(JOBS.paystackWebhook.name, handlePaystackWebhook),
  );
  // Imports download photos one by one; one at a time keeps memory low on a small server.
  await boss.work(
    JOBS.catalogImport.name,
    { localConcurrency: 1 },
    reported(JOBS.catalogImport.name, handleCatalogImport),
  );
  await boss.work(
    JOBS.shopifyWebhook.name,
    { localConcurrency: 1 },
    reported(JOBS.shopifyWebhook.name, handleShopifyWebhook),
  );
  await boss.work(
    JOBS.inboundMessage.name,
    { localConcurrency: 4 },
    reported(JOBS.inboundMessage.name, handleInboundMessage),
  );
  await boss.work(
    JOBS.sendMessage.name,
    { localConcurrency: 4 },
    reported(JOBS.sendMessage.name, handleSendMessage),
  );
  await boss.work(
    JOBS.agentReply.name,
    { localConcurrency: 4 },
    reported(JOBS.agentReply.name, handleAgentReply),
  );
  await boss.work(
    JOBS.ownerMessage.name,
    { localConcurrency: 2 },
    reported(JOBS.ownerMessage.name, handleOwnerMessage),
  );
  await boss.work(
    JOBS.ownerWhatsAppSend.name,
    { localConcurrency: 2 },
    reported(JOBS.ownerWhatsAppSend.name, makeOwnerWhatsAppSendHandler(platformWhatsApp)),
  );
  await boss.work(
    JOBS.channelWebhook.name,
    { localConcurrency: 2 },
    reported(JOBS.channelWebhook.name, handleChannelWebhook),
  );
  await boss.work(
    JOBS.messageStatus.name,
    { localConcurrency: 4 },
    reported(JOBS.messageStatus.name, handleMessageStatus),
  );
  await boss.work(
    JOBS.submitTemplates.name,
    { localConcurrency: 1 },
    reported(JOBS.submitTemplates.name, handleSubmitTemplates),
  );
  await boss.work(
    JOBS.customerNotifications.name,
    { localConcurrency: 1 },
    reported(JOBS.customerNotifications.name, () => handleCustomerNotifications()),
  );
  await boss.work(
    JOBS.ownerAlerts.name,
    { localConcurrency: 1 },
    reported(JOBS.ownerAlerts.name, () => handleOwnerAlerts()),
  );
  await boss.work(
    JOBS.submitPlatformTemplates.name,
    { localConcurrency: 1 },
    reported(JOBS.submitPlatformTemplates.name, () => handleSubmitPlatformTemplates()),
  );
  await boss.schedule(JOBS.ownerAlerts.name, '* * * * *', {}, { singletonKey: 'tick' });
  // Fake alert protection: payment claims checked against the money every minute.
  await boss.work(
    JOBS.paymentClaims.name,
    { localConcurrency: 1 },
    reported(JOBS.paymentClaims.name, () => handlePaymentClaims()),
  );
  await boss.schedule(JOBS.paymentClaims.name, '* * * * *', {}, { singletonKey: 'tick' });
  await boss.work(
    JOBS.refreshChannelTokens.name,
    { localConcurrency: 1 },
    reported(JOBS.refreshChannelTokens.name, () => handleRefreshChannelTokens()),
  );
  // Instagram tokens last 60 days; checked once a day (UTC).
  await boss.schedule(JOBS.refreshChannelTokens.name, '23 3 * * *', {}, { singletonKey: 'daily' });
  // Weekly database backup to a private bucket, Sundays 02:17 UTC (only when BACKUP_BUCKET is set).
  await boss.work(
    JOBS.databaseBackup.name,
    { localConcurrency: 1 },
    reported(JOBS.databaseBackup.name, () => handleDatabaseBackup()),
  );
  await boss.schedule(JOBS.databaseBackup.name, '17 2 * * 0', {}, { singletonKey: 'weekly' });
  // Fulcra's plans at Paystack (created once; only when Paystack is set up).
  await boss.work(
    JOBS.syncBillingPlans.name,
    { localConcurrency: 1 },
    reported(JOBS.syncBillingPlans.name, async () => {
      const created = await syncBillingPlans();
      if (created) console.info(`[worker] ${created} Paystack plan(s) created`);
    }),
  );
  if (process.env.PAYSTACK_SECRET_KEY) await enqueueSyncBillingPlans();
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
