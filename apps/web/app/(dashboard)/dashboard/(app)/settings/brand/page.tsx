import { getBrandKit } from '@fulcra/core';
import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { withUrls } from '@/lib/images';
import { BrandKitForm } from './brand-kit-form';
import { BackLink } from '@/components/page-header';

export const metadata: Metadata = { title: 'Brand kit' };

export default async function BrandKitPage() {
  const { actor, membership } = await getDashboardContext();
  const kit = await getBrandKit(actor);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <BackLink href="/settings">Settings</BackLink>
        <h1 className="text-3xl font-semibold">Brand kit</h1>
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
