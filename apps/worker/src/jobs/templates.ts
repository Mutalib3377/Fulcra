import { createWhatsAppTemplate, WhatsAppApiError } from '@fulcra/channels';
import {
  businessesWithWhatsApp,
  JOBS,
  markConnectionError,
  pendingCustomerNotifications,
  saveTemplateSubmission,
  sendCustomerNotification,
  templatesToSubmit,
} from '@fulcra/core';
import type { Job } from 'pg-boss';

const TOKEN_CODES = new Set([190, 102, 10, 200]);

function tokenOf(credentials: string | null): string | null {
  try {
    const token = (JSON.parse(credentials ?? '') as { accessToken?: unknown }).accessToken;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

/** Sends a newly connected number's templates to Meta for review. */
export async function handleSubmitTemplates(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const { businessId, connectionId } = JOBS.submitTemplates.data.parse(job.data);
    const todo = await templatesToSubmit(businessId, connectionId);
    const token = tokenOf(todo?.credentials ?? null);
    if (!todo || !token) continue;
    for (const template of todo.templates) {
      try {
        const result = await createWhatsAppTemplate(todo.businessAccountId, token, template);
        await saveTemplateSubmission(businessId, template.id, result);
      } catch (error) {
        if (!(error instanceof WhatsAppApiError)) throw error;
        if (error.code !== undefined && TOKEN_CODES.has(error.code)) {
          await markConnectionError(
            businessId,
            connectionId,
            'WhatsApp stopped accepting our access token (it may have expired or been removed).',
          );
          return;
        }
        if (error.status === 0 || error.status >= 500 || error.code === 4 || error.code === 80008)
          throw error; // temporary: retried
        // Refused outright (wording, name…): shown to the owner with Meta's reason.
        await saveTemplateSubmission(businessId, template.id, {
          externalId: null,
          status: 'REJECTED',
          reason: error.message.slice(0, 300),
        });
      }
    }
    console.info(`[worker] templates submitted for ${connectionId}: ${todo.templates.length}`);
  }
}

/**
 * Every minute: WhatsApp messages for new order events (confirmation, receipt, sent out,
 * delivered). Each event is sent once; ones waiting for template approval are tried again.
 */
export async function handleCustomerNotifications(): Promise<void> {
  for (const { businessId, connectedAt } of await businessesWithWhatsApp()) {
    try {
      for (const eventId of await pendingCustomerNotifications(businessId, connectedAt)) {
        const result = await sendCustomerNotification(businessId, eventId);
        if (result === 'queued') console.info(`[worker] customer message for event ${eventId}`);
      }
    } catch (error) {
      // One business's problem must not stop the others.
      console.error(`[worker] customer messages failed for ${businessId}`, error);
    }
  }
}
