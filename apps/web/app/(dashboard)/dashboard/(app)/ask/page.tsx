import { EmptyState } from '@fulcra/ui';
import { Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { getDashboardContext } from '@/lib/auth';
import { AskChat } from './ask-chat';

export const metadata: Metadata = { title: 'Ask Fulcra' };

export default async function AskPage() {
  const { membership } = await getDashboardContext();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Ask Fulcra"
        description="Ask about sales, orders and stock, or tell me what to change. Nothing changes until you reply YES."
      />
      {membership.role === 'owner' ? (
        <AskChat />
      ) : (
        <EmptyState
          icon={<Sparkles aria-hidden />}
          title="For the owner"
          description="Only the business owner can use the assistant chat."
        />
      )}
    </div>
  );
}
