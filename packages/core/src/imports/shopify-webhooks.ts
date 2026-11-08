import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { schema, withSystem } from '@fulcra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Shopify app webhooks (rule 8: verify → save raw event once → queue → 200).
 * We keep no Shopify customer data, so the privacy webhooks only need recording.
 * app/uninstalled and shop/redact remove the shop's keys from every business connected to it.
 */
export const SHOPIFY_WEBHOOK_TOPICS = [
  'app/uninstalled',
  'shop/redact',
  'customers/data_request',
  'customers/redact',
] as const;

export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(hmacHeader, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type ShopifyWebhookHeaders = {
  hmac: string | null;
  topic: string | null;
  shop: string | null;
  webhookId: string | null;
};

export type RecordShopifyWebhookResult =
  | { status: 'not_configured' | 'invalid_signature' | 'bad_payload' }
  | { status: 'duplicate'; webhookEventId: string; processed: boolean }
  | { status: 'saved'; webhookEventId: string };

export async function recordShopifyWebhook(
  rawBody: string,
  headers: ShopifyWebhookHeaders,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RecordShopifyWebhookResult> {
  const secret = env.SHOPIFY_API_SECRET;
  if (!secret) return { status: 'not_configured' };
  if (!verifyShopifyWebhook(rawBody, headers.hmac, secret)) return { status: 'invalid_signature' };
  const topic = z.enum(SHOPIFY_WEBHOOK_TOPICS).safeParse(headers.topic);
  const shop = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/)
    .safeParse(headers.shop);
  if (!topic.success || !shop.success) return { status: 'bad_payload' };
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 'bad_payload' };
  }
  const eventId =
    headers.webhookId ??
    `${topic.data}:${shop.data}:${createHash('sha256').update(rawBody).digest('hex')}`;

  return withSystem(async (tx) => {
    const [row] = await tx
      .insert(schema.webhookEvents)
      .values({
        provider: 'shopify',
        eventId,
        eventType: topic.data,
        payload: { shop: shop.data, body: body as Record<string, unknown> },
      })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    if (row) return { status: 'saved', webhookEventId: row.id } as const;
    const [existing] = await tx
      .select({ id: schema.webhookEvents.id, processedAt: schema.webhookEvents.processedAt })
      .from(schema.webhookEvents)
      .where(
        and(
          eq(schema.webhookEvents.provider, 'shopify'),
          eq(schema.webhookEvents.eventId, eventId),
        ),
      )
      .limit(1);
    return {
      status: 'duplicate',
      webhookEventId: existing!.id,
      processed: existing!.processedAt !== null,
    } as const;
  });
}

/** Worker: acts on a saved Shopify webhook. Safe to run twice. */
export async function processShopifyWebhook(
  webhookEventId: string,
): Promise<'processed' | 'already_processed' | 'not_found'> {
  return withSystem(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.webhookEvents)
      .where(
        and(
          eq(schema.webhookEvents.id, webhookEventId),
          eq(schema.webhookEvents.provider, 'shopify'),
        ),
      )
      .for('update')
      .limit(1);
    if (!event) return 'not_found';
    if (event.processedAt) return 'already_processed';
    const shop = String(event.payload.shop ?? '');
    if (event.eventType === 'app/uninstalled' || event.eventType === 'shop/redact') {
      await tx
        .update(schema.catalogSources)
        .set({
          status: 'disconnected',
          credentials: null,
          lastError: 'Fulcra was removed from this Shopify store.',
        })
        .where(
          and(eq(schema.catalogSources.kind, 'shopify'), eq(schema.catalogSources.shopUrl, shop)),
        );
    }
    await tx
      .update(schema.webhookEvents)
      .set({ processedAt: new Date(), attempts: event.attempts + 1 })
      .where(and(eq(schema.webhookEvents.id, event.id), isNull(schema.webhookEvents.processedAt)));
    return 'processed';
  });
}
