import { listCustomers, listDeliveryZones, listOrderableProducts } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDashboardContext } from '@/lib/auth';
import { imageUrls } from '@/lib/images';
import { NewOrderForm } from './new-order-form';

export const metadata: Metadata = { title: 'New order' };

type Props = { searchParams: Promise<{ customer?: string }> };

export default async function NewOrderPage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') redirect('/orders');
  const { customer: preselected } = await searchParams;
  const [products, customers, zones] = await Promise.all([
    listOrderableProducts(actor),
    listCustomers(actor),
    listDeliveryZones(actor, { activeOnly: true }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/orders" className="text-sm text-primary">
          ← Orders
        </Link>
        <h1 className="text-2xl font-bold">New order</h1>
      </div>
      <NewOrderForm
        preselectedCustomerId={preselected ?? null}
        products={products.map(({ photo, ...p }) => ({
          ...p,
          thumb: photo ? imageUrls(photo).sm : null,
        }))}
        customers={customers.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          address: c.address,
          deliveryZoneId: c.deliveryZoneId,
        }))}
        zones={zones.map((z) => ({
          id: z.id,
          name: z.name,
          fee: z.fee,
          estimatedTime: z.estimatedTime,
        }))}
      />
    </div>
  );
}
