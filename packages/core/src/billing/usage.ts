import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordEvent } from '../events/events';
import { planStateInTx } from './entitlements';

/** The business's month as "2026-11" (its own time zone). */
async function monthKey(tx: Tx, now: Date): Promise<{ key: string; start: Date }> {
  const [business] = await tx
    .select({ timezone: schema.businesses.timezone })
    .from(schema.businesses)
    .limit(1);
  const tz = business?.timezone ?? 'Africa/Lagos';
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .format(now)
    .slice(0, 7);
  return { key, start: now };
}

async function usedInTx(tx: Tx, key: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.usageRecords)
    .where(
      and(
        eq(schema.usageRecords.kind, 'agent_conversation'),
        sql`${schema.usageRecords.reference} like ${`%:${key}`}`,
      ),
    );
  return row?.n ?? 0;
}

export type AgentAllowance =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; reason: string; used: number; limit: number };

/**
 * Before the assistant replies (worker): is the assistant in the plan, and does this chat fit
 * in the month's conversations? A chat counts once a month, however many messages it has
 * (rule 6, `usage_records` kind agent_conversation). Crossing 80% and 100% writes a
 * `usage.limit` event once a month (owner alert and dashboard banner).
 */
export async function claimAgentConversation(
  businessId: string,
  conversationId: string,
  now = new Date(),
): Promise<AgentAllowance> {
  const id = z.uuid().parse(businessId);
  const conv = z.uuid().parse(conversationId);
  return withTenant(id, async (tx) => {
    // One at a time per business, so two chats can't both take the last conversation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-usage:${id}`}))`);
    const state = await planStateInTx(tx, now);
    const { key } = await monthKey(tx, now);
    const used = await usedInTx(tx, key);
    const limit = state.conversationLimit;
    if (!state.features.has('agent')) {
      return {
        allowed: false,
        used,
        limit,
        reason: state.active
          ? 'The assistant is switched off for this business'
          : 'Your Fulcra plan has ended, so the assistant is paused',
      };
    }
    const reference = `conv:${conv}:${key}`;
    const [counted] = await tx
      .select({ id: schema.usageRecords.id })
      .from(schema.usageRecords)
      .where(
        and(
          eq(schema.usageRecords.kind, 'agent_conversation'),
          eq(schema.usageRecords.reference, reference),
        ),
      )
      .limit(1);
    if (counted) return { allowed: true, used, limit };
    if (used >= limit) {
      return { allowed: false, used, limit, reason: 'Monthly assistant limit reached' };
    }
    await tx.insert(schema.usageRecords).values({
      businessId: id,
      kind: 'agent_conversation',
      feature: 'agent.conversation',
      reference,
      quantity: 1,
      costUsd: 0,
    });
    const now_used = used + 1;
    for (const percent of [80, 100] as const) {
      if (now_used < Math.ceil((limit * percent) / 100)) continue;
      const [seen] = await tx
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(
          and(
            eq(schema.events.type, 'usage.limit'),
            sql`${schema.events.payload}->>'month' = ${key}`,
            sql`(${schema.events.payload}->>'percent')::int = ${percent}`,
          ),
        )
        .limit(1);
      if (!seen)
        await recordEvent(tx, id, {
          type: 'usage.limit',
          actor: { type: 'system' },
          payload: { month: key, percent, used: now_used, limit },
        });
    }
    return { allowed: true, used: now_used, limit };
  });
}

/** Assistant conversations used this month and the limit (for the dashboard). */
export async function conversationUsage(
  businessId: string,
  now = new Date(),
): Promise<{ used: number; limit: number; month: string }> {
  const id = z.uuid().parse(businessId);
  return withTenant(id, async (tx) => {
    const state = await planStateInTx(tx, now);
    const { key } = await monthKey(tx, now);
    return { used: await usedInTx(tx, key), limit: state.conversationLimit, month: key };
  });
}
