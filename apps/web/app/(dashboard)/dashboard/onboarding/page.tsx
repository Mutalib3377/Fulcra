import { listMyBusinesses } from '@fulcra/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getRootDomain } from '@/lib/host-routing';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: 'Set up your business' };

type Props = { searchParams: Promise<{ new?: string }> };

export default async function OnboardingPage({ searchParams }: Props) {
  const user = await requireUser('/onboarding');
  const { new: addAnother } = await searchParams;
  const memberships = await listMyBusinesses(user.id);
  if (memberships.length > 0 && !addAnother) redirect('/');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-primary">Step 1 of 1</p>
        <h1 className="text-2xl font-bold">Tell us about your business</h1>
        <p className="text-muted-foreground">You can change these later in Settings.</p>
      </div>
      <OnboardingForm storeDomain={getRootDomain().replace(/:\d+$/, '')} />
    </main>
  );
}
