import { instagramAdapter } from '@fulcra/channels';
import { enqueueChannelWebhook, recordChannelWebhook } from '@fulcra/core';

/**
 * Instagram webhook for all businesses (each message names the Instagram account).
 * Rule 8: verify signature → save the raw event once → enqueue → 200 quickly.
 */

/** Meta's check when the webhook address is set up (same verify token as WhatsApp). */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (
    expected &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token') === expected
  ) {
    return new Response(params.get('hub.challenge') ?? '', {
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new Response('Forbidden', { status: 403 });
}

async function enqueue(webhookEventId: string): Promise<Response> {
  try {
    await enqueueChannelWebhook(webhookEventId);
    return new Response('OK');
  } catch (error) {
    console.error('[webhooks/instagram] could not enqueue', error);
    return new Response('Try again', { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!process.env.INSTAGRAM_APP_SECRET) {
    console.error('[webhooks/instagram] INSTAGRAM_APP_SECRET is not set');
    return new Response('Not configured', { status: 503 });
  }
  const rawBody = await request.text();
  if (rawBody.length > 1024 * 1024) return new Response('Payload too large', { status: 413 });
  if (!instagramAdapter.verifyWebhook(rawBody, request.headers)) {
    return new Response('Invalid signature', { status: 401 });
  }
  const result = await recordChannelWebhook('instagram', rawBody);
  switch (result.status) {
    case 'bad_payload':
      return new Response('Bad payload', { status: 400 });
    case 'duplicate':
      if (result.processed) return new Response('OK');
      return enqueue(result.webhookEventId);
    case 'saved':
      return enqueue(result.webhookEventId);
  }
}
