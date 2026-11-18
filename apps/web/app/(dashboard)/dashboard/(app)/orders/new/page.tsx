import { listCustomers, listDeliveryZones, listOrderableProducts } from '@fulcra/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDashboardContext } from '@/lib/auth';
import { imageUrls } from '@/lib/images';
import { NewOrderForm } from './new-order-form';
import { BackLink } from '@/components/page-header';

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
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <BackLink href="/orders">Orders</BackLink>
        <h1 className="text-3xl font-semibold">New order</h1>
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
