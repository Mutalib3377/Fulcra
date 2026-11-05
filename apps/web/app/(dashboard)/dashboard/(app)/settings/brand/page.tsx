import { getBrandKit } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { withUrls } from '@/lib/images';
import { BrandKitForm } from './brand-kit-form';

export const metadata: Metadata = { title: 'Brand kit' };

export default async function BrandKitPage() {
  const { actor, membership } = await getDashboardContext();
  const kit = await getBrandKit(actor);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Brand kit</h1>
        <p className="text-muted-foreground">
          How your store looks and how your assistant talks to customers.
        </p>
      </div>
      <BrandKitForm
        businessName={membership.businessName}
        canEdit={membership.role === 'owner'}
        initial={{
          logo: kit.logo ? withUrls(kit.logo) : null,
          primaryColour: kit.primaryColour,
          accentColour: kit.accentColour,
          font: kit.font,
          voice: kit.voice,
          voiceNotes: kit.voiceNotes,
          description: kit.description,
        }}
      />
    </div>
  );
}
