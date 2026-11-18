import { getOwnerAlertSettings } from '@fulcra/core';
import { EmptyState } from '@fulcra/ui';
import { MessageCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { getDashboardContext } from '@/lib/auth';
import { AskChat } from './ask-chat';

export const metadata: Metadata = { title: 'Ask Fulcra' };

export default async function AskPage() {
  const { membership, actor } = await getDashboardContext();
  const isOwner = membership.role === 'owner';
  const ownerNumber = isOwner ? (await getOwnerAlertSettings(actor)).ownerWhatsapp : null;
  const fulcraNumber = process.env.FULCRA_WHATSAPP_DISPLAY_NUMBER?.replace(/[^\d+]/g, '') || null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Ask Fulcra"
        description="Ask about sales, orders and stock, or tell me what to change. Nothing changes until you reply YES."
      />
      {isOwner && fulcraNumber && (
        <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm shadow-card">
          <MessageCircle className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          {ownerNumber ? (
            <p>
              Also on WhatsApp: message{' '}
              <a
                href={`https://wa.me/${fulcraNumber.replace('+', '')}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Fulcra ({fulcraNumber})
              </a>{' '}
              from {ownerNumber}.
            </p>
          ) : (
            <p>
              Chat with Fulcra on WhatsApp too: add your number in{' '}
              <Link href="/settings/alerts" className="font-medium text-primary">
                Settings → Alerts
              </Link>
              .
            </p>
          )}
        </div>
      )}
      {isOwner ? (
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
