import { describe, expect, it } from 'vitest';
import { getBusiness } from '../src/businesses/get-business';
import { createInvite, listPendingInvites, revokeInvite } from '../src/members/invites';
import { listMembers, listMyBusinesses } from '../src/members/memberships';
import { newBusiness } from './helpers';

/**
 * C1 "Done when": two test businesses exist and neither can see the other's data.
 * Covers both guards: the role check in Core services and Postgres RLS.
 */
describe('tenant isolation between two businesses', () => {
  it('a member of A cannot read B by passing B’s id', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const ownerAInB = { businessId: b.business.id, userId: a.owner.userId };

    await expect(getBusiness(ownerAInB)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listMembers(ownerAInB)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listPendingInvites(ownerAInB)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      createInvite(ownerAInB, { email: 'x@example.com', role: 'staff' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('each business sees only its own team and invites', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    await createInvite(a.actor, { email: 'staff-a@example.com', role: 'staff' });
    await createInvite(b.actor, { email: 'staff-b@example.com', role: 'rider' });

    const teamA = await listMembers(a.actor);
    expect(teamA.map((m) => m.email)).toEqual([a.owner.email]);

    const invitesA = await listPendingInvites(a.actor);
    expect(invitesA.map((i) => i.email)).toEqual(['staff-a@example.com']);
  });

  it('A cannot revoke B’s invite even with its id (RLS hides the row)', async () => {
    const a = await newBusiness('a');
    const b = await newBusiness('b');
    const { invite } = await createInvite(b.actor, { email: 'target@example.com', role: 'staff' });

    await revokeInvite(a.actor, invite.id);

    const stillPending = await listPendingInvites(b.actor);
    expect(stillPending.map((i) => i.id)).toContain(invite.id);
  });

  it('a user only lists businesses they belong to', async () => {
    const a = await newBusiness('a');
    await newBusiness('b');
    const mine = await listMyBusinesses(a.owner.userId);
    expect(mine.map((m) => m.businessId)).toEqual([a.business.id]);
  });
});
