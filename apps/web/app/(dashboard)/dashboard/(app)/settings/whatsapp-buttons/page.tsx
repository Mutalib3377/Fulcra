import { getBrandKit, getBusiness, listProducts } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { WhatsAppButtons } from './whatsapp-buttons';

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">WhatsApp buttons</h1>
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
