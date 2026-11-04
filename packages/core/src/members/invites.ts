import { createHash, randomBytes } from 'node:crypto';
import { schema, withSystem, withTenant } from '@fulcra/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { CoreError } from '../shared/errors';
import { requireMember, type ActorContext } from './access';

export const INVITE_LIFETIME_DAYS = 7;

const invitableRoles = ['staff', 'rider'] as const;

export const createInviteInput = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  role: z.enum(invitableRoles, { message: 'Choose a role.' }),
});

export type CreateInviteInput = z.input<typeof createInviteInput>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Owner invites someone by email. Returns the secret token for the invite link
 * (shared by the owner, e.g. on WhatsApp). Only its hash is stored.
 * Any earlier pending invite for the same email is replaced.
 */
export async function createInvite(
  actor: ActorContext,
  input: CreateInviteInput,
): Promise<{ invite: schema.MemberInvite; token: string }> {
  const data = createInviteInput.parse(input);

  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);

    const [existingMember] = await tx
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.email, data.email))
      .limit(1);
    if (existingMember) {
      throw new CoreError('conflict', 'This person is already in your team.', 'email');
    }

    await tx
      .update(schema.memberInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.memberInvites.email, data.email),
          isNull(schema.memberInvites.acceptedAt),
          isNull(schema.memberInvites.revokedAt),
        ),
      );

    const token = randomBytes(32).toString('base64url');
    const [invite] = await tx
      .insert(schema.memberInvites)
      .values({
        businessId: actor.businessId,
        email: data.email,
        role: data.role,
        tokenHash: hashToken(token),
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!invite) throw new Error('Invite insert returned no row');
    return { invite, token };
  });
}

export type PendingInvite = Pick<
  schema.MemberInvite,
  'id' | 'email' | 'role' | 'expiresAt' | 'createdAt'
>;

/** Invites that can still be accepted. Owner only. */
export async function listPendingInvites(actor: ActorContext): Promise<PendingInvite[]> {
  return withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    return tx
      .select({
        id: schema.memberInvites.id,
        email: schema.memberInvites.email,
        role: schema.memberInvites.role,
        expiresAt: schema.memberInvites.expiresAt,
        createdAt: schema.memberInvites.createdAt,
      })
      .from(schema.memberInvites)
      .where(
        and(
          isNull(schema.memberInvites.acceptedAt),
          isNull(schema.memberInvites.revokedAt),
          gt(schema.memberInvites.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.memberInvites.createdAt));
  });
}

/** Cancels an invite. Owner only. */
export async function revokeInvite(actor: ActorContext, inviteId: string): Promise<void> {
  const id = z.uuid().parse(inviteId);
  await withTenant(actor.businessId, async (tx) => {
    await requireMember(tx, actor, ['owner']);
    await tx
      .update(schema.memberInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.memberInvites.id, id), isNull(schema.memberInvites.acceptedAt)));
  });
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type InvitePreview = {
  businessName: string;
  email: string;
  role: schema.MemberRole;
  status: InviteStatus;
};

function statusOf(invite: schema.MemberInvite, now = new Date()): InviteStatus {
  if (invite.acceptedAt) return 'accepted';
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt <= now) return 'expired';
  return 'pending';
}

/**
 * What the invite page shows before accepting. System query: the visitor is not a member
 * yet. Looked up only by the hash of the secret token.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  if (!token) return null;
  const rows = await withSystem((tx) =>
    tx
      .select({ invite: schema.memberInvites, businessName: schema.businesses.name })
      .from(schema.memberInvites)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.memberInvites.businessId))
      .where(eq(schema.memberInvites.tokenHash, hashToken(token)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    businessName: row.businessName,
    email: row.invite.email,
    role: row.invite.role,
    status: statusOf(row.invite),
  };
}

/**
 * The signed-in user accepts an invite. Their email must match the invite.
 * System transaction: the user is not a member of the business yet.
 */
export async function acceptInvite(params: {
  token: string;
  userId: string;
  email: string;
}): Promise<{ businessId: string }> {
  return withSystem(async (tx) => {
    const [invite] = await tx
      .select()
      .from(schema.memberInvites)
      .where(eq(schema.memberInvites.tokenHash, hashToken(params.token)))
      .for('update')
      .limit(1);
    if (!invite) throw new CoreError('not_found', 'This invite link is not valid.');

    const status = statusOf(invite);
    if (status === 'revoked') throw new CoreError('conflict', 'This invite was cancelled.');
    if (status === 'expired') {
      throw new CoreError('conflict', 'This invite has expired. Ask for a new one.');
    }
    if (status === 'accepted' && invite.acceptedBy !== params.userId) {
      throw new CoreError('conflict', 'This invite has already been used.');
    }
    if (invite.email !== params.email.toLowerCase()) {
      throw new CoreError(
        'forbidden',
        `This invite was sent to ${invite.email}. Sign in with that email to accept it.`,
      );
    }

    await tx
      .insert(schema.members)
      .values({
        businessId: invite.businessId,
        userId: params.userId,
        email: invite.email,
        role: invite.role,
      })
      .onConflictDoNothing({ target: [schema.members.businessId, schema.members.userId] });

    if (status === 'pending') {
      await tx
        .update(schema.memberInvites)
        .set({ acceptedAt: new Date(), acceptedBy: params.userId })
        .where(eq(schema.memberInvites.id, invite.id));
    }
    return { businessId: invite.businessId };
  });
}
