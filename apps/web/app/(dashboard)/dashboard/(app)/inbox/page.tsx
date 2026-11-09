import { Button } from '@fulcra/ui';
import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { InboxList } from './inbox-list';

export const metadata: Metadata = { title: 'Inbox' };

export default async function InboxPage() {
  const { membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">The inbox is for the owner and staff.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Inbox</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/inbox/test">
            <FlaskConical aria-hidden /> Test chat
          </Link>
        </Button>
      </div>
      <InboxList />
    </div>
  );
}
