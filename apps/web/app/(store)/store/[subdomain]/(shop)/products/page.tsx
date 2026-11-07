import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadStore, loadStoreProducts } from '@/lib/store';
import { pageNumber, ProductListPage } from '../../_components/product-list-page';
import { shareMetadata } from '../../_components/share';

type Props = {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) return {};
  return {
    title: 'All products',
    ...shareMetadata(store, {
      path: '/products',
      title: `All products · ${store.name}`,
      description: `Everything from ${store.name}. Order on WhatsApp.`,
      image: store.brand.logo,
    }),
  };
}

export default async function AllProducts({ params, searchParams }: Props) {
  const { subdomain } = await params;
  const store = await loadStore(subdomain);
  if (!store) notFound();
  const page = pageNumber((await searchParams).page);
  const result = await loadStoreProducts(store.businessId, null, page);
  return <ProductListPage title="All products" basePath="/products" {...result} />;
}
