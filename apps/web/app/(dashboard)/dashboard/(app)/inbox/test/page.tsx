import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { TestChat } from './test-chat';
import { BackLink } from '@/components/page-header';

export const metadata: Metadata = { title: 'Test chat' };

/** Try the inbox (and, from A2, your assistant) as if you were a customer. */
export default async function TestChatPage() {
  const { membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">The inbox is for the owner and staff.</p>;
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <BackLink href="/inbox">Inbox</BackLink>
        <h1 className="text-3xl font-semibold">Test chat</h1>
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
