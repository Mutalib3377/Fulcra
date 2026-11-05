import { listCategories } from '@fulcra/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDashboardContext } from '@/lib/auth';
import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'Add product' };

export default async function NewProductPage() {
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') redirect('/catalog');
  const categories = await listCategories(actor);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/catalog" className="text-sm text-primary">
          ← Catalog
        </Link>
        <h1 className="text-2xl font-bold">Add product</h1>
      </div>
      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
