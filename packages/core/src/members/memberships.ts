import { schema, withSystem, withTenant } from '@fulcra/db';
import { asc, eq } from 'drizzle-orm';
import { requireMember, type ActorContext, type MemberRole } from './access';

export type Membership = {
  businessId: string;
  businessName: string;
  subdomain: string;
  role: MemberRole;
};

/**
 * All businesses the user belongs to. A system query by design: it must look across
 * businesses, and it is filtered by the signed-in user's id.
 */
export async function listMyBusinesses(userId: string): Promise<Membership[]> {
  return withSystem((tx) =>
    tx
      .select({
        businessId: schema.businesses.id,
        businessName: schema.businesses.name,
        subdomain: schema.businesses.subdomain,
        role: schema.members.role,
      })
      .from(schema.members)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.members.businessId))
      .where(eq(schema.members.userId, userId))
      .orderBy(asc(schema.members.createdAt)),
  );
}

export type TeamMember = Pick<schema.Member, 'id' | 'userId' | 'email' | 'role' | 'createdAt'>;

/** Everyone in the actor's business. Any member can see the team. */
export async function listMembers(actor: ActorContext): Promise<TeamMember[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor);
    return tx
      .select({
        id: schema.members.id,
        userId: schema.members.userId,
        email: schema.members.email,
        role: schema.members.role,
        createdAt: schema.members.createdAt,
      })
      .from(schema.members)
      .orderBy(asc(schema.members.createdAt));
  });
}
