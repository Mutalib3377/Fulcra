import { getAgentSettings } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { AssistantForm } from './assistant-form';

export const metadata: Metadata = { title: 'Assistant' };

export default async function AssistantSettingsPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') {
    return <p className="text-muted-foreground">Assistant settings are for the owner and staff.</p>;
  }
  const settings = await getAgentSettings(actor);
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Your assistant</h1>
        <p className="text-muted-foreground">
          It answers customers, finds products, takes orders and sends payment links, and passes
          chats to your team when it isn’t sure.
        </p>
      </div>
      {!aiReady && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          The AI service isn’t connected yet, so while the assistant is on, every chat is passed to
          your team. (Set ANTHROPIC_API_KEY.)
        </p>
      )}
      <AssistantForm initial={settings} canEdit={membership.role === 'owner'} />
    </div>
  );
}
