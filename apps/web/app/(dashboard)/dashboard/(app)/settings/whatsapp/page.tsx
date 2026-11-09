import { listChannelConnections } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { WhatsAppConnection } from './whatsapp-connection';

export const metadata: Metadata = { title: 'WhatsApp' };

export default async function WhatsAppSettingsPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">WhatsApp settings are for the owner and staff.</p>;
  }
  const connection =
    (await listChannelConnections(actor)).find((c) => c.channel === 'whatsapp') ?? null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">WhatsApp</h1>
        <p className="text-muted-foreground">
          Connect your business WhatsApp number so customers’ messages arrive in your inbox and your
          assistant can answer them.
        </p>
      </div>
      <WhatsAppConnection
        connection={
          connection && {
            id: connection.id,
            displayName: connection.displayName,
            status: connection.status,
            lastError: connection.lastError,
            phoneNumberId: connection.externalAccountId,
          }
        }
        canEdit={membership.role === 'owner'}
      />
    </div>
  );
}
