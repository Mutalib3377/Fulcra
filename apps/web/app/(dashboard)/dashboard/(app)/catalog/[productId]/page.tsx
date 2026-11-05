import { getProduct, isCoreError, listCategories } from '@fulcra/core';
import { EmptyState, Button } from '@fulcra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDashboardContext } from '@/lib/auth';
import { toFormValues } from '../form-data';
import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'Edit product' };

type Props = { params: Promise<{ productId: string }> };

export default async function EditProductPage({ params }: Props) {
  const { productId } = await params;
  const { actor, membership } = await getDashboardContext();
  if (membership.role === 'rider') redirect('/catalog');

  const notFound = (
    <EmptyState
      title="Product not found"
      description="It may have been deleted."
      action={
        <Button asChild variant="outline">
          <Link href="/catalog">Back to catalog</Link>
        </Button>
      }
    />
  );
  if (!z.uuid().safeParse(productId).success) return notFound;

  let product;
  try {
    product = await getProduct(actor, productId);
  } catch (error) {
    if (isCoreError(error) && error.code === 'not_found') return notFound;
    throw error;
  }
  const categories = await listCategories(actor);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <Link href="/catalog" className="text-sm text-primary">
          ← Catalog
        </Link>
        <h1 className="truncate text-2xl font-bold">{product.product.name}</h1>
      </div>
      <ProductForm
        mode="edit"
        productId={productId}
        initial={toFormValues(product)}
        categories={categories}
      />
    </div>
  );
}
