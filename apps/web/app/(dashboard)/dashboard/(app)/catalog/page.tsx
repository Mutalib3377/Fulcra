import { formatNaira } from '@fulcra/config';
import { listCategories, listProducts, productListFilter } from '@fulcra/core';
import { Badge, Button, Card, EmptyState, Input, NativeSelect, cn } from '@fulcra/ui';
import { ImageIcon, Plus, Search, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getDashboardContext } from '@/lib/auth';
import { imageUrls } from '@/lib/images';
import { ActiveToggle } from './active-toggle';

export const metadata: Metadata = { title: 'Catalog' };

type Props = { searchParams: Promise<{ q?: string; category?: string; show?: string }> };

const tabs = [
  { show: 'all', label: 'All' },
  { show: 'low_stock', label: 'Low stock' },
  { show: 'hidden', label: 'Hidden' },
] as const;

export default async function CatalogPage({ searchParams }: Props) {
  const { actor, membership } = await getDashboardContext();
  const params = await searchParams;
  const filter = productListFilter.safeParse({
    search: params.q || undefined,
    category: params.category || undefined,
    show: params.show || undefined,
  });
  const f = filter.success ? filter.data : productListFilter.parse({});
  const [products, categories] = await Promise.all([listProducts(actor, f), listCategories(actor)]);
  const canEdit = membership.role !== 'rider';
  const filtered = Boolean(f.search || f.category || f.show !== 'all');

  const tabHref = (show: string) => {
    const q = new URLSearchParams();
    if (f.search) q.set('q', f.search);
    if (f.category) q.set('category', f.category);
    if (show !== 'all') q.set('show', show);
    const s = q.toString();
    return s ? `/catalog?${s}` : '/catalog';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Catalog</h1>
        {canEdit && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/catalog/import">
                <Upload aria-hidden /> Import
              </Link>
            </Button>
            <Button asChild>
              <Link href="/catalog/new">
                <Plus aria-hidden /> Add product
              </Link>
            </Button>
          </div>
        )}
      </div>

      <form action="/catalog" method="get" className="flex flex-col gap-2 sm:flex-row">
        {f.show !== 'all' && <input type="hidden" name="show" value={f.show} />}
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={f.search ?? ''}
            placeholder="Search products"
            className="pl-9"
            aria-label="Search products"
          />
        </div>
        {categories.length > 0 && (
          <NativeSelect
            name="category"
            defaultValue={f.category ?? ''}
            aria-label="Category"
            className="sm:w-48"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <nav aria-label="Filter" className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.show}
            href={tabHref(tab.show)}
            aria-current={f.show === tab.show ? 'page' : undefined}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm whitespace-nowrap',
              f.show === tab.show ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {products.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No products match"
            description="Try another search or filter."
            action={
              <Button asChild variant="outline">
                <Link href="/catalog">Show all products</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No products yet"
            description="Add your products so customers and the assistant can see prices and stock."
            action={
              canEdit ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link href="/catalog/new">
                      <Plus aria-hidden /> Add your first product
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/catalog/import">
                      <Upload aria-hidden /> Import from a spreadsheet
                    </Link>
                  </Button>
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {products.length} {products.length === 1 ? 'product' : 'products'}
          </p>
          <ul className="flex flex-col gap-2">
            {products.map((p) => {
              const thumb = p.photo ? imageUrls(p.photo).sm : null;
              return (
                <li key={p.id}>
                  <Card className="flex items-center gap-3 p-2 pr-3">
                    <Link
                      href={canEdit ? `/catalog/${p.id}` : '#'}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                          <img
                            src={thumb}
                            alt=""
                            width={64}
                            height={64}
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-sm">{formatNaira(p.retailPrice)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>
                            {p.totalStock} in stock
                            {p.hasOptions ? ` · ${p.optionCount} options` : ''}
                          </span>
                          {p.lowStock && <Badge tone="warning">Low stock</Badge>}
                          {!p.isActive && <Badge tone="neutral">Hidden</Badge>}
                        </div>
                      </div>
                    </Link>
                    {canEdit && (
                      <ActiveToggle productId={p.id} isActive={p.isActive} name={p.name} />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
