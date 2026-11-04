import { describe, expect, it } from 'vitest';
import { getDb, schema } from '@fulcra/db';
import { eq } from 'drizzle-orm';
import {
  acceptInvite,
  createInvite,
  getInvitePreview,
  listPendingInvites,
  revokeInvite,
} from '../src/members/invites';
import { listMembers, listMyBusinesses } from '../src/members/memberships';
import { newBusiness, newUser } from './helpers';

describe('staff invites', () => {
  it('owner invites, invitee previews and accepts with the right email', async () => {
    const { business, actor } = await newBusiness();
    const staff = newUser('staff');
    const { token, invite } = await createInvite(actor, {
      email: staff.email.toUpperCase(),
      role: 'staff',
    });
    expect(invite.email).toBe(staff.email);
    expect(invite.tokenHash).not.toContain(token);

    expect(await getInvitePreview(token)).toMatchObject({
      businessName: business.name,
      role: 'staff',
      status: 'pending',
    });

    const result = await acceptInvite({ token, ...staff });
    expect(result.businessId).toBe(business.id);

    const team = await listMembers(actor);
    expect(team).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: staff.email, role: 'staff' })]),
    );
    expect(await listMyBusinesses(staff.userId)).toHaveLength(1);
    expect(await getInvitePreview(token)).toMatchObject({ status: 'accepted' });
    expect(await listPendingInvites(actor)).toEqual([]);

    // Accepting again is harmless for the same user, refused for anyone else.
    await expect(acceptInvite({ token, ...staff })).resolves.toEqual({ businessId: business.id });
    await expect(acceptInvite({ token, ...newUser() })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a different email', async () => {
    const { actor } = await newBusiness();
    const { token } = await createInvite(actor, { email: 'right@example.com', role: 'rider' });
    await expect(
      acceptInvite({ token, userId: crypto.randomUUID(), email: 'wrong@example.com' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses revoked, expired and unknown invites', async () => {
    const { actor } = await newBusiness();
    const revoked = await createInvite(actor, { email: 'r@example.com', role: 'staff' });
    await revokeInvite(actor, revoked.invite.id);
    await expect(
      acceptInvite({ token: revoked.token, userId: crypto.randomUUID(), email: 'r@example.com' }),
    ).rejects.toMatchObject({ code: 'conflict' });

    const expired = await createInvite(actor, { email: 'e@example.com', role: 'staff' });
    await getDb()
      .update(schema.memberInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.memberInvites.id, expired.invite.id));
    await expect(
      acceptInvite({ token: expired.token, userId: crypto.randomUUID(), email: 'e@example.com' }),
    ).rejects.toMatchObject({ code: 'conflict' });

    await expect(
      acceptInvite({ token: 'nope', userId: crypto.randomUUID(), email: 'x@example.com' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await getInvitePreview('nope')).toBeNull();
  });

  it('only owners invite, and existing members cannot be invited again', async () => {
    const { actor, owner } = await newBusiness();
    const staff = newUser('staff');
    const { token } = await createInvite(actor, { email: staff.email, role: 'staff' });
    await acceptInvite({ token, ...staff });

    await expect(
      createInvite(
        { businessId: actor.businessId, userId: staff.userId },
        { email: 'n@example.com', role: 'staff' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createInvite(actor, { email: owner.email, role: 'staff' })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('a new invite to the same email replaces the old one', async () => {
    const { actor } = await newBusiness();
    const first = await createInvite(actor, { email: 'same@example.com', role: 'staff' });
    await createInvite(actor, { email: 'same@example.com', role: 'rider' });
    expect(await getInvitePreview(first.token)).toMatchObject({ status: 'revoked' });
    expect((await listPendingInvites(actor)).map((i) => i.role)).toEqual(['rider']);
  });
});
