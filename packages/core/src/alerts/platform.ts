import { schema, withSystem } from '@fulcra/db';
import { and, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { renderTemplate, templateStatusFromMeta } from '../conversations/templates';

/**
 * Fulcra's own WhatsApp number, which sends owner alerts and briefings (A4,
 * docs/decisions/0015). Set once with environment variables; during development it can be
 * Meta's test number.
 */
export type PlatformWhatsApp = {
  phoneNumberId: string;
  businessAccountId: string;
  /** Credentials in the same shape as a connection's (JSON with accessToken). */
  credentials: string;
};

export function platformWhatsApp(env: NodeJS.ProcessEnv = process.env): PlatformWhatsApp | null {
  const phoneNumberId = env.FULCRA_WHATSAPP_PHONE_NUMBER_ID?.trim();
  const businessAccountId = env.FULCRA_WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  const accessToken = env.FULCRA_WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !businessAccountId || !accessToken) return null;
  return { phoneNumberId, businessAccountId, credentials: JSON.stringify({ accessToken }) };
}

export const ALERT_KINDS = [
  'paid_order',
  'low_stock',
  'unmatched_payment',
  'waiting_customer',
  'briefing',
  'test',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

type PlatformTemplate = { name: string; body: string; examples: string[] };

/**
 * Templates on Fulcra's number. Plain utility wording; placeholders never first or last.
 * A wording change needs a new name.
 */
export const PLATFORM_TEMPLATES: Record<AlertKind, PlatformTemplate> = {
  paid_order: {
    name: 'fulcra_alert_paid_order_v1',
    body: 'New paid order {{1}} at {{2}}: {{3}} from {{4}}. See it here: {{5}} (Fulcra alert)',
    examples: [
      '#1024',
      'Ada Styles',
      '₦17,000.00',
      'Chioma',
      'https://app.yourdomain.com/orders/1',
    ],
  },
  low_stock: {
    name: 'fulcra_alert_low_stock_v1',
    body: 'Low stock at {{1}}: {{2}} has {{3}} left. Update it here: {{4}} (Fulcra alert)',
    examples: ['Ada Styles', 'Ankara Midi Dress (M)', '2', 'https://app.yourdomain.com/catalog/1'],
  },
  unmatched_payment: {
    name: 'fulcra_alert_unmatched_payment_v1',
    body: 'A payment of {{1}} reached {{2}} but could not be matched to an order. Check it here: {{3}} (Fulcra alert)',
    examples: ['₦17,000.00', 'Ada Styles', 'https://app.yourdomain.com/payments'],
  },
  waiting_customer: {
    name: 'fulcra_alert_waiting_customer_v1',
    body: '{{1}} is waiting for a reply at {{2}}. Reason: {{3}}. Open the chat: {{4}} (Fulcra alert)',
    examples: [
      'Chioma',
      'Ada Styles',
      'Customer asked for a person',
      'https://app.yourdomain.com/inbox/1',
    ],
  },
  briefing: {
    name: 'fulcra_daily_briefing_v1',
    body: 'Good morning! Yesterday ({{1}}) {{2}} made {{3}} from {{4}} paid orders. Right now: {{5}} orders waiting for payment ({{6}}), {{7}} to send out, {{8}} products low on stock, {{9}} chats waiting for you. Open Fulcra: {{10}} Have a good day!',
    examples: [
      'Sunday 9 November',
      'Ada Styles',
      '₦85,000.00',
      '6',
      '3',
      '₦41,000.00',
      '2',
      '4',
      '1',
      'https://app.yourdomain.com',
    ],
  },
  test: {
    name: 'fulcra_alert_test_v1',
    body: 'Hello, this is a test alert from Fulcra for {{1}}. Your WhatsApp alerts are working.',
    examples: ['Ada Styles'],
  },
};

/** Adds missing platform templates (worker start). */
export async function ensurePlatformTemplates(): Promise<void> {
  await withSystem((tx) =>
    tx
      .insert(schema.platformTemplates)
      .values(
        ALERT_KINDS.map((purpose) => ({
          purpose,
          name: PLATFORM_TEMPLATES[purpose].name,
          body: PLATFORM_TEMPLATES[purpose].body,
        })),
      )
      .onConflictDoNothing(),
  );
}

/** Worker: platform templates not yet sent to Meta. */
export async function platformTemplatesToSubmit() {
  const rows = await withSystem((tx) =>
    tx
      .select()
      .from(schema.platformTemplates)
      .where(eq(schema.platformTemplates.status, 'not_submitted')),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    language: r.language,
    category: r.category,
    body: r.body,
    examples: PLATFORM_TEMPLATES[r.purpose as AlertKind]?.examples ?? [],
  }));
}

export async function savePlatformTemplateSubmission(
  templateId: string,
  result: { externalId: string | null; status: string; reason?: string | null },
): Promise<void> {
  await withSystem((tx) =>
    tx
      .update(schema.platformTemplates)
      .set({
        externalId: result.externalId,
        status: templateStatusFromMeta(result.status),
        statusReason: result.reason ?? null,
        submittedAt: new Date(),
      })
      .where(eq(schema.platformTemplates.id, z.uuid().parse(templateId))),
  );
}

/** A template webhook for Fulcra's own account. Returns how many changed. */
export async function applyPlatformTemplateStatus(update: {
  businessAccountId: string;
  externalId?: string;
  name?: string;
  status: string;
  reason?: string | null;
}): Promise<number> {
  const platform = platformWhatsApp();
  if (!platform || platform.businessAccountId !== update.businessAccountId) return 0;
  const t = schema.platformTemplates;
  const match = update.externalId
    ? or(
        eq(t.externalId, update.externalId),
        update.name ? and(eq(t.name, update.name), isNull(t.externalId)) : undefined,
      )
    : update.name
      ? eq(t.name, update.name)
      : undefined;
  if (!match) return 0;
  const status = templateStatusFromMeta(update.status);
  const reason =
    update.reason && update.reason.toUpperCase() !== 'NONE'
      ? update.reason.replace(/_/g, ' ').toLowerCase()
      : null;
  const rows = await withSystem((tx) =>
    tx
      .update(t)
      .set({
        status,
        statusReason: status === 'approved' ? null : reason,
        ...(update.externalId ? { externalId: update.externalId } : {}),
      })
      .where(match)
      .returning({ id: t.id }),
  );
  return rows.length;
}

/** The approved platform template for an alert kind, or null. */
export async function approvedPlatformTemplate(kind: AlertKind) {
  const [row] = await withSystem((tx) =>
    tx
      .select()
      .from(schema.platformTemplates)
      .where(
        and(
          eq(schema.platformTemplates.purpose, kind),
          eq(schema.platformTemplates.status, 'approved'),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

/** Where Fulcra's alert messages are with Meta (shown on the Alerts page). */
export async function platformAlertsStatus(): Promise<{
  configured: boolean;
  approved: number;
  total: number;
}> {
  const rows = await withSystem((tx) =>
    tx.select({ status: schema.platformTemplates.status }).from(schema.platformTemplates),
  );
  return {
    configured: platformWhatsApp() !== null,
    approved: rows.filter((r) => r.status === 'approved').length,
    total: ALERT_KINDS.length,
  };
}

export function alertText(kind: AlertKind, params: string[]): string {
  return renderTemplate(PLATFORM_TEMPLATES[kind].body, params);
}
