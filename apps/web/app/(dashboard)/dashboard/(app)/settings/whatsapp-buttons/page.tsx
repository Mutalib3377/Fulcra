import { getBrandKit, getBusiness, listProducts } from '@fulcra/core';
import type { Metadata } from 'next';
import { getDashboardContext } from '@/lib/auth';
import { WhatsAppButtons } from './whatsapp-buttons';
import { BackLink } from '@/components/page-header';

export const metadata: Metadata = { title: 'WhatsApp buttons' };

/** Copy-paste "Chat on WhatsApp" buttons and links for sellers' own websites (I2). */
export default async function WhatsAppButtonsPage() {
  const { actor } = await getDashboardContext();
  const [business, kit, products] = await Promise.all([
    getBusiness(actor),
    getBrandKit(actor),
    listProducts(actor),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <BackLink href="/settings">Settings</BackLink>
        <h1 className="text-3xl font-semibold">WhatsApp buttons</h1>
        <p className="text-muted-foreground">
          Let customers on your website, Instagram or flyers start a WhatsApp chat with you in one
          tap. Copy a link or a button and paste it where you want it.
        </p>
      </div>
      <WhatsAppButtons
        businessName={business.name}
        whatsappNumber={business.whatsappNumber}
        colour={kit.primaryColour}
        products={products
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.name, price: p.retailPrice, hasOptions: p.hasOptions }))}
      />
    </div>
  );
}
