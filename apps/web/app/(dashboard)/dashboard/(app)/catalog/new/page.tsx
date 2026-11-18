import { listCategories } from '@fulcra/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDashboardContext } from '@/lib/auth';
import { ProductForm } from '../product-form';
import { BackLink } from '@/components/page-header';

export const metadata: Metadata = { title: 'Add product' };

export default async function NewProductPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') redirect('/catalog');
  const categories = await listCategories(actor);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <BackLink href="/catalog">Catalog</BackLink>
        <h1 className="text-3xl font-semibold">Add product</h1>
      </div>
      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
