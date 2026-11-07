import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadStore, loadStoreProducts } from '@/lib/store';
import { pageNumber, ProductListPage } from '../../../_components/product-list-page';
import { shareMetadata } from '../../../_components/share';

type Props = {
  params: Promise<{ subdomain: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function categoryName(raw: string): string | null {
  try {
    const name = decodeURIComponent(raw).trim();
    return name.length > 0 && name.length <= 60 ? name : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain, category } = await params;
  const store = await loadStore(subdomain);
  const name = categoryName(category);
  if (!store || !name) return {};
  const { products } = await loadStoreProducts(store.businessId, name, 1);
  return {
    title: name,
    ...shareMetadata(store, {
      path: `/c/${encodeURIComponent(name)}`,
      title: `${name} · ${store.name}`,
      description: `Shop ${name} from ${store.name}. Order on WhatsApp.`,
      image: products.find((p) => p.photo)?.photo ?? store.brand.logo,
    }),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { subdomain, category } = await params;
  const store = await loadStore(subdomain);
  const name = categoryName(category);
  if (!store || !name) notFound();
  const page = pageNumber((await searchParams).page);
  const result = await loadStoreProducts(store.businessId, name, page);
  if (page === 1 && result.products.length === 0) notFound();
  return <ProductListPage title={name} basePath={`/c/${encodeURIComponent(name)}`} {...result} />;
}
