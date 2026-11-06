import { enqueuePaystackWebhook, recordPaystackWebhook } from '@fulcra/core';

/**
 * Paystack webhook (rule 8): verify signature → save the raw event once → enqueue → 200.
 * The worker does the slow part (asking Paystack to confirm, marking the order paid).
 */
/**
 * If queueing fails we answer 500 so Paystack retries. The retry arrives as a duplicate that is
 * not yet processed, and is queued again. Processing is idempotent, so this is always safe.
 */
async function enqueue(webhookEventId: string): Promise<Response> {
  try {
    await enqueuePaystackWebhook(webhookEventId);
    return new Response('OK');
  } catch (error) {
    console.error('[webhooks/paystack] could not enqueue', error);
    return new Response('Try again', { status: 500 });
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return new Response('Payload too large', { status: 413 });

  const result = await recordPaystackWebhook(rawBody, request.headers.get('x-paystack-signature'));
  switch (result.status) {
    case 'invalid_signature':
      return new Response('Invalid signature', { status: 401 });
    case 'not_configured':
      console.error('[webhooks/paystack] PAYSTACK_SECRET_KEY is not set');
      return new Response('Not configured', { status: 503 });
    case 'bad_payload':
      return new Response('Bad payload', { status: 400 });
    case 'duplicate':
      if (result.processed) return new Response('OK');
      return enqueue(result.webhookEventId);
    case 'saved':
      return enqueue(result.webhookEventId);
  }
}
