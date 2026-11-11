import { getInstagramAppConfig } from '@fulcra/channels';
import { listChannelConnections } from '@fulcra/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fulcra/ui';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { getDashboardContext } from '@/lib/auth';
import { disconnectInstagramAction } from './actions';

export const metadata: Metadata = { title: 'Instagram' };

const ERRORS: Record<string, string> = {
  not_set_up: 'Instagram connection is not set up on Fulcra yet.',
  not_allowed: 'Only the business owner can connect Instagram.',
  cancelled: 'Instagram was not connected. You can try again.',
  taken: 'This Instagram account is already connected to another Fulcra business.',
  failed: 'Instagram could not be connected. Please try again.',
};

export default async function InstagramSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Instagram settings are for the owner and staff.</p>;
  }
  const query = await searchParams;
  const connection =
    (await listChannelConnections(actor)).find((c) => c.channel === 'instagram') ?? null;
  const configured = getInstagramAppConfig() !== null;
  const isOwner = membership.role === 'owner';
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Instagram</h1>
        <p className="text-muted-foreground">
          Connect your Instagram account so DMs arrive in your inbox and your assistant can answer
          them.
        </p>
      </div>
      {query.connected && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          Instagram is connected. New DMs will appear in your inbox.
        </p>
      )}
      {query.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {ERRORS[query.error] ?? ERRORS.failed}
        </p>
      )}

      {connection ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              {connection.status === 'connected' ? (
                <CheckCircle2 className="size-5 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="size-5 text-warning" aria-hidden />
              )}
              <CardTitle>
                {connection.status === 'connected' ? 'Connected' : 'Needs attention'}
              </CardTitle>
            </div>
            <CardDescription>{connection.displayName || 'Your Instagram account'}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {connection.status === 'error' && connection.lastError && (
              <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                {connection.lastError}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Instagram only lets you reply within 24 hours of a customer’s last message, and it has
              no template messages. Fulcra stays connected by renewing access automatically.
            </p>
            {isOwner && (
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/integrations/instagram/start"
                  className="inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
                >
                  Connect again
                </a>
                <ActionButton
                  variant="ghost"
                  action={disconnectInstagramAction.bind(null, connection.id)}
                  redirectTo="/settings/instagram"
                >
                  Disconnect
                </ActionButton>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connect Instagram</CardTitle>
            <CardDescription>
              You need an Instagram professional account (Business or Creator). You will log in on
              Instagram and allow Fulcra to read and answer your messages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!configured ? (
              <p className="text-sm text-muted-foreground">
                Instagram connection is not set up on Fulcra yet.
              </p>
            ) : isOwner ? (
              <a
                href="/api/integrations/instagram/start"
                className="inline-flex h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Connect Instagram
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask the business owner to connect Instagram.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
