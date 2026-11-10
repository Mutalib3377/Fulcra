import { schema, withTenant } from '@fulcra/db';
import { z } from 'zod';

/**
 * Claude API prices in US dollars per million tokens (Anthropic first-party rates).
 * Update when prices change; unknown models are costed at the most expensive known rate
 * so we never under-count.
 */
export const AI_PRICES_USD_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

const MOST_EXPENSIVE = AI_PRICES_USD_PER_MTOK['claude-fable-5-1']!;

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** Cost of one AI call in US dollars, rounded to 6 decimals. */
export function aiCallCostUsd(model: string, usage: AiTokenUsage): number {
  const price = AI_PRICES_USD_PER_MTOK[model] ?? MOST_EXPENSIVE;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

const aiUsageInput = z.object({
  feature: z.string().min(1).max(60),
  model: z.string().min(1).max(80),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0).optional(),
  cacheWriteTokens: z.number().int().min(0).optional(),
});

/** Logs an AI call and its cost against the business that caused it (rule 12). */
export async function recordAiUsage(
  businessId: string,
  input: z.input<typeof aiUsageInput>,
): Promise<schema.UsageRecord> {
  const id = z.uuid().parse(businessId);
  const data = aiUsageInput.parse(input);
  return withTenant(id, async (tx) => {
    const [row] = await tx
      .insert(schema.usageRecords)
      .values({
        businessId: id,
        kind: 'ai_call',
        feature: data.feature,
        model: data.model,
        inputTokens: data.inputTokens + (data.cacheReadTokens ?? 0) + (data.cacheWriteTokens ?? 0),
        outputTokens: data.outputTokens,
        quantity: 1,
        costUsd: aiCallCostUsd(data.model, data),
      })
      .returning();
    return row!;
  });
}

/**
 * What Meta charges per delivered WhatsApp message, in US dollars, by pricing category, for
 * messages to Nigerian numbers (where our sellers' customers are). Since October 2026 replies
 * inside the 24-hour window ("service") are charged like utility messages. Figures from
 * published rate summaries; check Meta's rate card and update here when it changes.
 * Unknown categories are costed at the highest rate so we never under-count.
 */
export const WHATSAPP_PRICES_USD: Record<string, number> = {
  service: 0.0101,
  utility: 0.0101,
  authentication: 0.0101,
  authentication_international: 0.0101,
  marketing: 0.062,
  marketing_lite: 0.062,
};
const HIGHEST_WHATSAPP_PRICE = Math.max(...Object.values(WHATSAPP_PRICES_USD));

export function whatsAppMessageCostUsd(category: string): number {
  return WHATSAPP_PRICES_USD[category] ?? HIGHEST_WHATSAPP_PRICE;
}

const whatsAppUsageInput = z.object({
  /** The WhatsApp message id: each message is charged once, however often Meta reports it. */
  reference: z.string().min(1).max(200),
  /** Meta's pricing category from the delivery update (service, utility, marketing…). */
  category: z.string().min(1).max(60),
  /** What caused it, when not a customer chat (e.g. "owner_alert"). */
  feature: z.string().min(1).max(60).optional(),
});

/**
 * Logs a WhatsApp message Meta charges for, against the business (rule 12). Idempotent by
 * message id (rule 9). Returns false when it was already logged.
 */
export async function recordWhatsAppUsage(
  businessId: string,
  input: z.input<typeof whatsAppUsageInput>,
): Promise<boolean> {
  const id = z.uuid().parse(businessId);
  const data = whatsAppUsageInput.parse(input);
  return withTenant(id, async (tx) => {
    const rows = await tx
      .insert(schema.usageRecords)
      .values({
        businessId: id,
        kind: 'whatsapp_message',
        feature: data.feature ? `${data.feature}.${data.category}` : `whatsapp.${data.category}`,
        reference: data.reference,
        quantity: 1,
        costUsd: whatsAppMessageCostUsd(data.category),
      })
      .onConflictDoNothing()
      .returning({ id: schema.usageRecords.id });
    return rows.length > 0;
  });
}
