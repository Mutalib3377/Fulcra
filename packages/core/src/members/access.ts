import { schema, type Tx } from '@fulcra/db';
import { and, eq } from 'drizzle-orm';
import { CoreError } from '../shared/errors';

export type MemberRole = schema.MemberRole;

/** Who is acting, and in which business. Built by the app from the signed-in user. */
export type ActorContext = {
  businessId: string;
  userId: string;
};

/**
 * Loads the actor's membership inside a tenant transaction and checks their role.
 * Throws `forbidden` when they are not a member or their role is not allowed.
 */
export async function requireMember(
  tx: Tx,
  actor: ActorContext,
  allowedRoles?: readonly MemberRole[],
): Promise<schema.Member> {
  const [member] = await tx
    .select()
    .from(schema.members)
    .where(
      and(eq(schema.members.businessId, actor.businessId), eq(schema.members.userId, actor.userId)),
    )
    .limit(1);
  if (!member) throw new CoreError('forbidden', 'You are not a member of this business.');
  if (allowedRoles && !allowedRoles.includes(member.role)) {
    throw new CoreError('forbidden', 'You do not have permission to do this.');
  }
  return member;
}

/**
 * The AI assistant acting for a business: no signed-in user. Only Core's assistant services
 * (src/agent) create it, for a conversation the assistant is handling.
 */
export type AssistantActor = { businessId: string; assistant: true };

/**
 * A shopper paying on a business's store (K1): no signed-in user. Only Core's store checkout
 * service (src/storefront/checkout.ts) creates it, for an order it has just created.
 */
export type StorefrontActor = { businessId: string; storefront: true };

/** Someone who can take an action: a team member, the assistant, or a store checkout. */
export type Performer = ActorContext | AssistantActor | StorefrontActor;

export function isAssistant(performer: Performer): performer is AssistantActor {
  return 'assistant' in performer && performer.assistant === true;
}

export function isTeamMember(performer: Performer): performer is ActorContext {
  return 'userId' in performer;
}

/**
 * Checks the role of a team member; the assistant's and the store checkout's access is decided
 * by their own services.
 */
export async function authorize(
  tx: Tx,
  performer: Performer,
  allowedRoles?: readonly MemberRole[],
): Promise<void> {
  if (!isTeamMember(performer)) return;
  await requireMember(tx, performer, allowedRoles);
}

/** The user behind an action, or null for the assistant or a store checkout. */
export function performerUserId(performer: Performer): string | null {
  return isTeamMember(performer) ? performer.userId : null;
}
