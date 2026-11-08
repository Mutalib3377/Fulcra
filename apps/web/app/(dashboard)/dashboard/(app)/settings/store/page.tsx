import { getBusiness } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { StoreChoiceForm } from './store-choice-form';

export const metadata: Metadata = { title: 'Store or website' };

type Props = { searchParams: Promise<{ welcome?: string }> };

/** "Use our store" or "Connect my website". Shown right after sign-up, and in Settings. */
export default async function StoreChoicePage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  const business = await getBusiness(actor);
  const welcome = (await searchParams).welcome === '1';
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        {welcome ? (
          <p className="text-sm font-medium text-success">Your business is ready.</p>
        ) : (
          <Link href="/settings" className="text-sm text-primary">
            ← Settings
          </Link>
        )}
        <h1 className="text-2xl font-bold">How will customers shop with you?</h1>
        <p className="text-muted-foreground">You can change this any time in Settings.</p>
      </div>
      <StoreChoiceForm
        initialChoice={business.hasExternalWebsite ? 'website' : 'store'}
        initialWebsite={business.websiteUrl ?? ''}
        canEdit={membership.role === 'owner'}
      />
      {welcome && (
        <Link
          href="/"
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Skip for now
        </Link>
      )}
    </div>
  );
}
