import { listMembers, listPendingInvites } from '@fulcra/core';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { InviteForm, RevokeInviteButton } from './team-forms';

export const metadata: Metadata = { title: 'Team' };

const roleLabels = { owner: 'Owner', staff: 'Staff', rider: 'Rider' } as const;

const dateFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short' });

export default async function TeamPage() {
  const { actor, membership, user } = await getDashboardContext();
  const isOwner = membership.role === 'owner';
  const [members, invites] = await Promise.all([
    listMembers(actor),
    isOwner ? listPendingInvites(actor) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Team</h1>
      </div>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              You will get a link to send them. They sign in with the same email to join.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 truncate">
                  {m.email}
                  {m.userId === user.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>
                  {roleLabels[m.role]}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting to join</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate">{invite.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {roleLabels[invite.role]} · link expires {dateFormat.format(invite.expiresAt)}
                    </p>
                  </div>
                  <RevokeInviteButton inviteId={invite.id} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
