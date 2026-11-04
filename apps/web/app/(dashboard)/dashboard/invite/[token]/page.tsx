import { APP_NAME } from '@fulcra/config';
import { getInvitePreview } from '@fulcra/core';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { AcceptInviteButton } from './accept-button';

export const metadata: Metadata = { title: 'Join a team' };

type Props = { params: Promise<{ token: string }> };

const roleLabels = { owner: 'owner', staff: 'staff member', rider: 'rider' } as const;

const statusMessages = {
  accepted: 'This invite has already been used.',
  revoked: 'This invite was cancelled. Ask the business owner for a new one.',
  expired: 'This invite has expired. Ask the business owner for a new one.',
} as const;

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const [invite, user] = await Promise.all([getInvitePreview(token), getCurrentUser()]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <p className="text-center text-lg font-bold text-primary">{APP_NAME}</p>
      {!invite ? (
        <EmptyState title="Invite not found" description="Check that you opened the full link." />
      ) : invite.status !== 'pending' ? (
        <EmptyState
          title="This invite can't be used"
          description={statusMessages[invite.status]}
          action={
            user ? (
              <Button asChild variant="outline">
                <Link href="/">Go to dashboard</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Join {invite.businessName}</CardTitle>
            <CardDescription>
              You have been invited as a {roleLabels[invite.role]}. This invite is for{' '}
              <span className="font-medium text-foreground">{invite.email}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!user ? (
              <Button asChild fullWidth>
                <Link href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>
                  Sign in to accept
                </Link>
              </Button>
            ) : user.email !== invite.email ? (
              <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                You are signed in as {user.email}. Sign out and sign in with {invite.email} to
                accept.
              </p>
            ) : (
              <AcceptInviteButton token={token} />
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
