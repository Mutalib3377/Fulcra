import { EmptyState } from '@fulcra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Inbox' };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Inbox</h1>
      <EmptyState
        title="No chats yet"
        description="Messages from WhatsApp, Instagram and your website will appear here."
      />
    </div>
  );
}
