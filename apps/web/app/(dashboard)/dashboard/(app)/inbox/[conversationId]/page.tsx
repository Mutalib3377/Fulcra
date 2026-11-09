import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { ChatView } from './chat-view';

export const metadata: Metadata = { title: 'Chat' };

export default async function ChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">The inbox is for the owner and staff.</p>;
  }
  const { conversationId } = await params;
  return (
    <div className="mx-auto w-full max-w-2xl">
      <ChatView conversationId={conversationId} />
    </div>
  );
}
