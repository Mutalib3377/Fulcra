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
