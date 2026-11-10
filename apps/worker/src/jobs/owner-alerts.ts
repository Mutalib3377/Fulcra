import {
  adapterFor,
  ChannelSendError,
  createWhatsAppTemplate,
  WhatsAppApiError,
} from '@fulcra/channels';
import {
  alertsToSend,
  businessesWithAlerts,
  claimOwnerAlert,
  createBriefingIfDue,
  createPendingAlerts,
  markOwnerAlertFailed,
  markOwnerAlertSent,
  platformTemplatesToSubmit,
  platformWhatsApp,
  savePlatformTemplateSubmission,
} from '@fulcra/core';

/**
 * Every minute: new events become owner alerts, the daily briefing is added when due, and
 * pending alerts are sent from Fulcra's WhatsApp number with the approved template.
 */
export async function handleOwnerAlerts(): Promise<void> {
  const adapter = adapterFor('whatsapp');
  if (!adapter) return;
  for (const businessId of await businessesWithAlerts()) {
    try {
      await createPendingAlerts(businessId);
      await createBriefingIfDue(businessId);
      for (const id of await alertsToSend(businessId)) {
        const delivery = await claimOwnerAlert(businessId, id);
        if (delivery.status !== 'ready') continue;
        try {
          const { externalId } = await adapter.send({
            accountId: delivery.accountId,
            credentials: delivery.credentials,
            to: delivery.to,
            message: { type: 'template', ...delivery.template, text: delivery.text },
          });
          await markOwnerAlertSent(businessId, id, externalId);
        } catch (error) {
          // Temporary problems are tried again next minute.
          if (error instanceof ChannelSendError && !error.retry)
            await markOwnerAlertFailed(businessId, id, error.message);
          else console.warn('[worker] owner alert will be retried', id);
        }
      }
    } catch (error) {
      console.error(`[worker] owner alerts failed for ${businessId}`, error);
    }
  }
}

/** Sends the templates of Fulcra's own number to Meta (once; at worker start). */
export async function handleSubmitPlatformTemplates(): Promise<void> {
  const platform = platformWhatsApp();
  if (!platform) return;
  const token = (JSON.parse(platform.credentials) as { accessToken: string }).accessToken;
  for (const template of await platformTemplatesToSubmit()) {
    try {
      const result = await createWhatsAppTemplate(platform.businessAccountId, token, template);
      await savePlatformTemplateSubmission(template.id, result);
    } catch (error) {
      if (!(error instanceof WhatsAppApiError)) throw error;
      if (error.status === 0 || error.status >= 500) throw error; // retried
      console.error('[worker] platform template refused', template.name, error.message);
      await savePlatformTemplateSubmission(template.id, {
        externalId: null,
        status: 'REJECTED',
        reason: error.message.slice(0, 300),
      });
    }
  }
}
