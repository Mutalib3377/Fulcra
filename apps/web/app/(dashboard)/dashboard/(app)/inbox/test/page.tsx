import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { TestChat } from './test-chat';

export const metadata: Metadata = { title: 'Test chat' };

/** Try the inbox (and, from A2, your assistant) as if you were a customer. */
export default async function TestChatPage() {
  const { membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">The inbox is for the owner and staff.</p>;
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/inbox" className="text-sm text-primary">
          ← Inbox
        </Link>
        <h1 className="text-2xl font-bold">Test chat</h1>
        <p className="text-muted-foreground">
          Pretend to be a customer. Your messages arrive in your inbox like real ones (marked
          “Test”), so you can see how chats work before connecting WhatsApp. Real customers never
          see this.
        </p>
      </div>
      <TestChat />
    </div>
  );
}
