import { schema, withTenant, type Tx } from '@fulcra/db';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  isAssistant,
  isTeamMember,
  requireMember,
  type ActorContext,
  type Performer,
} from '../members/access';

/** Every event type written today. Other parts of the app react to these (jobs, alerts). */
export const EVENT_TYPES = [
  'customer.created',
  'customer.linked',
  'order.created',
  'order.status_changed',
  'order.paid',
  'order.cancelled',
  'stock.low',
  'payment.confirmed',
  'payment.needs_review',
  'payment.unmatched',
  'payment.claim_unverified',
  'payment.claim_cleared',
  'payment.claim_dismissed',
  'catalog.imported',
  'conversation.started',
  'conversation.handoff',
  'channel.connected',
  'channel.disconnected',
  'usage.limit',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type EventActorRef = { type: schema.EventActor; id?: string | null };

/** The actor reference for a signed-in user's action. */
export const userActor = (actor: ActorContext): EventActorRef => ({
  type: 'user',
  id: actor.userId,
});

/** The actor reference for anyone who can act: a member, the assistant or a store shopper. */
export function performerActor(performer: Performer): EventActorRef {
  if (isTeamMember(performer)) return userActor(performer);
  return isAssistant(performer) ? { type: 'agent' } : { type: 'customer' };
}

export type NewEvent = {
  type: EventType;
  actor: EventActorRef;
  orderId?: string | null;
  customerId?: string | null;
  payload?: Record<string, unknown>;
};

/** Writes an event inside the caller's transaction, so it exists only if the action succeeded. */
export async function recordEvent(tx: Tx, businessId: string, event: NewEvent): Promise<void> {
  await tx.insert(schema.events).values({
    businessId,
    type: event.type,
    actorType: event.actor.type,
    actorId: event.actor.id ?? null,
    orderId: event.orderId ?? null,
    customerId: event.customerId ?? null,
    payload: event.payload ?? {},
  });
}

export const listEventsFilter = z.object({
  orderId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

/** Activity feed, newest first. Optionally for one order or one customer. */
export async function listEvents(
  actor: ActorContext,
  filter: z.input<typeof listEventsFilter> = {},
): Promise<schema.Event[]> {
  const f = listEventsFilter.parse(filter);
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    const conditions: SQL[] = [];
    if (f.orderId) conditions.push(eq(schema.events.orderId, f.orderId));
    if (f.customerId) conditions.push(eq(schema.events.customerId, f.customerId));
    return tx
      .select()
      .from(schema.events)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.events.createdAt), desc(schema.events.id))
      .limit(f.limit);
  });
}
