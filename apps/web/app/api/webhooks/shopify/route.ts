import { enqueueShopifyWebhook, recordShopifyWebhook } from '@fulcra/core';

/**
 * Shopify app webhooks (rule 8): verify → save the raw event once → enqueue → 200.
 * Topics: app/uninstalled, shop/redact, customers/data_request, customers/redact.
 */
async function enqueue(webhookEventId: string): Promise<Response> {
  try {
    await enqueueShopifyWebhook(webhookEventId);
    return new Response('OK');
  } catch (error) {
    console.error('[webhooks/shopify] could not enqueue', error);
    return new Response('Try again', { status: 500 });
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (rawBody.length > 512 * 1024) return new Response('Payload too large', { status: 413 });
  const result = await recordShopifyWebhook(rawBody, {
    hmac: request.headers.get('x-shopify-hmac-sha256'),
    topic: request.headers.get('x-shopify-topic'),
    shop: request.headers.get('x-shopify-shop-domain'),
    webhookId:
      request.headers.get('x-shopify-webhook-id') ?? request.headers.get('x-shopify-event-id'),
  });
  switch (result.status) {
    case 'invalid_signature':
      return new Response('Invalid signature', { status: 401 });
    case 'not_configured':
      console.error('[webhooks/shopify] SHOPIFY_API_SECRET is not set');
      return new Response('Not configured', { status: 503 });
    case 'bad_payload':
      return new Response('Bad payload', { status: 400 });
    case 'duplicate':
      return result.processed ? new Response('OK') : enqueue(result.webhookEventId);
    case 'saved':
      return enqueue(result.webhookEventId);
  }
}
