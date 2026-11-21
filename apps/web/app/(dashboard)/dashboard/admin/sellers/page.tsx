import { formatNaira } from '@fulcra/config';
import { adminBusinessFilter, adminListBusinesses } from '@fulcra/core';
import { Badge, Card, EmptyState, cn } from '@fulcra/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { formatUsd, requireAdminPage } from '@/lib/admin';
import { formatDateTime } from '@/lib/orders';
import { STATUS_LABEL, STATUS_TONE } from '../status';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const TABS = [
  ['all', 'All'],
  ['trialing', 'Free trial'],
  ['paying', 'Paying'],
  ['expired', 'Ended'],
] as const;

/** Every seller, newest first: search, filter by plan status, this month's activity and cost. */
export default async function AdminSellersPage({ searchParams }: Props) {
  const admin = await requireAdminPage();
  const raw = await searchParams;
  const f = adminBusinessFilter.parse({ q: raw.q ?? '', status: raw.status, page: raw.page });
  const result = await adminListBusinesses(admin, f);
  const link = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams({
      q: f.q,
      status: f.status,
      page: String(f.page),
      ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, String(v)])),
    });
    for (const [k, v] of [...params])
      if (!v || (k === 'status' && v === 'all') || (k === 'page' && v === '1')) params.delete(k);
    const query = params.toString();
    return query ? `/admin/sellers?${query}` : '/admin/sellers';
  };
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sellers"
        description={`${result.total} ${result.total === 1 ? 'seller' : 'sellers'}${f.q ? ` matching "${f.q}"` : ''}`}
      />
      <form method="get" action="/admin/sellers" className="flex gap-2">
        <input type="hidden" name="status" value={f.status} />
        <label className="relative flex-1">
          <span className="sr-only">Search sellers</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            name="q"
            defaultValue={f.q}
            placeholder="Business name, store address or owner email"
            className="h-11 w-full rounded-full border border-input bg-card pr-4 pl-9 text-base outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          className="h-11 rounded-full bg-primary px-5 font-medium text-primary-foreground"
        >
          Search
        </button>
      </form>
      <nav aria-label="Filter by status" className="flex gap-2 overflow-x-auto">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={link({ status: key, page: 1 })}
            aria-current={f.status === key ? 'page' : undefined}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm whitespace-nowrap',
              f.status === key ? 'border-primary bg-primary text-primary-foreground' : 'bg-card',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {result.rows.length === 0 ? (
        <EmptyState
          title="No sellers found"
          description={f.q ? 'Try another search.' : 'Sellers appear here when they sign up.'}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {result.rows.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/sellers/${r.id}`} className="block">
                <Card className="flex flex-col gap-2 p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {r.subdomain} · {r.ownerEmail ?? 'no owner'} · joined{' '}
                      {formatDateTime(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:justify-end">
                    <span className="text-muted-foreground">
                      {r.ordersThisMonth} orders · {formatNaira(r.salesThisMonth)} ·{' '}
                      {r.chatsThisMonth} chats
                    </span>
                    <span className="font-medium" title="What this seller cost Fulcra this month">
                      {formatUsd(r.costUsdThisMonth)}
                    </span>
                    {r.suspended ? <Badge tone="danger">Suspended</Badge> : null}
                    <Badge tone={STATUS_TONE[r.status]}>
                      {STATUS_LABEL[r.status]}
                      {r.status !== 'trialing' && r.status !== 'expired' ? ` · ${r.plan}` : ''}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {f.page > 1 || result.hasMore ? (
        <div className="flex justify-between">
          {f.page > 1 ? (
            <Link
              href={link({ page: f.page - 1 })}
              className="rounded-full border bg-card px-4 py-2 text-sm"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {result.hasMore ? (
            <Link
              href={link({ page: f.page + 1 })}
              className="rounded-full border bg-card px-4 py-2 text-sm"
            >
              Next →
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        This month: orders placed, paid sales, assistant chats, and what the seller cost Fulcra in
        AI and WhatsApp.
      </p>
    </div>
  );
}
