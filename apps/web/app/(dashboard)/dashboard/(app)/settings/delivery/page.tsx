import { listDeliveryZones } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { ZoneEditor } from './zone-editor';

export const metadata: Metadata = { title: 'Delivery areas' };

export default async function DeliveryZonesPage() {
  const { actor, membership } = await getDashboardContext();
  const zones = await listDeliveryZones(actor);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/settings" className="text-sm text-primary">
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold">Delivery areas</h1>
        <p className="text-muted-foreground">
          Where you deliver and how much it costs. The fee is added to orders automatically.
        </p>
      </div>
      <ZoneEditor
        canEdit={membership.role !== 'rider'}
        zones={zones.map((z) => ({
          id: z.id,
          name: z.name,
          fee: z.fee,
          estimatedTime: z.estimatedTime,
          isActive: z.isActive,
        }))}
      />
    </div>
  );
}
