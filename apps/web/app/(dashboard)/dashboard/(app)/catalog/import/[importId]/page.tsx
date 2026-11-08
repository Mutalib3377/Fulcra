import { formatNaira } from '@fulcra/config';
import { getImport, isCoreError, type ImportItemView } from '@fulcra/core';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@fulcra/ui';
import { CheckCircle2 } from 'lucide-react';
import type { Metadata } from 'next';
import { ZodError } from 'zod';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { getDashboardContext } from '@/lib/auth';
import { IMPORT_KIND_LABEL, IMPORT_STATUS } from '../status';
import { ImportReview, type ReviewItem } from './import-review';

export const metadata: Metadata = { title: 'Import' };

type Props = { params: Promise<{ importId: string }> };

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function toReviewItem(item: ImportItemView): ReviewItem {
  const { data } = item;
  const prices = data.variants.map((v) => v.priceOverride ?? data.retailPrice);
  const min = Math.min(...prices, data.retailPrice);
  const hasRange = new Set(prices).size > 1;
  const options = data.variants.filter((v) => v.size || v.colour).length;
  const stock = data.variants.reduce((n, v) => n + (v.stock ?? 0), 0);
  const details = [
    options > 0 ? plural(options, 'option', 'options') : null,
    `${stock} in stock`,
    data.category,
    data.photoUrls.length > 0 ? plural(data.photoUrls.length, 'photo', 'photos') : 'no photos',
  ].filter(Boolean);
  return {
    id: item.id,
    name: data.name,
    sourceRef: item.sourceRef,
    priceLabel: data.retailPrice > 0 ? `${hasRange ? 'From ' : ''}${formatNaira(min)}` : '—',
    details: details.join(' · '),
    errors: item.problems.filter((p) => p.level === 'error').map((p) => p.message),
    warnings: item.problems.filter((p) => p.level === 'warning').map((p) => p.message),
    approved: item.decision === 'approved',
  };
}

export default async function ImportDetailPage({ params }: Props) {
  const { importId } = await params;
  const { actor } = await getDashboardContext();
  let view;
  try {
    view = await getImport(actor, importId);
  } catch (error) {
    // A wrong or old link (bad id, or another business's import).
    if (isCoreError(error) || error instanceof ZodError) {
      return (
        <EmptyState
          title="Import not found"
          description="It may have been removed."
          action={
            <Button asChild variant="outline">
              <Link href="/catalog/import">Back to imports</Link>
            </Button>
          }
        />
      );
    }
    throw error;
  }
  const { import: run, items } = view;
  const status = IMPORT_STATUS[run.status];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <Link href="/catalog/import" className="text-sm text-primary">
          ← Imports
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold break-all">
            {run.label || IMPORT_KIND_LABEL[run.kind]}
          </h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-muted-foreground">{IMPORT_KIND_LABEL[run.kind]}</p>
      </div>

      {run.status === 'review' && (
        <ImportReview importId={run.id} items={items.map(toReviewItem)} />
      )}

      {(run.status === 'saving' || run.status === 'queued' || run.status === 'fetching') && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <AutoRefresh seconds={3} />
            <p className="font-semibold">
              {run.status === 'saving'
                ? `Bringing in ${run.processedItems} of ${run.totalItems} products…`
                : 'Getting your products…'}
            </p>
            <div
              className="h-3 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={run.totalItems || 1}
              aria-valuenow={run.processedItems}
              aria-label="Import progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{
                  width: `${run.totalItems ? Math.round((run.processedItems / run.totalItems) * 100) : 5}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Photos are downloaded one by one, so this can take a few minutes. You can leave this
              page; the import carries on.
            </p>
          </CardContent>
        </Card>
      )}

      {run.status === 'done' && <ImportSummary run={run} items={items} />}

      {run.status === 'failed' && (
        <EmptyState
          title="This import did not finish"
          description={run.error ?? 'Something went wrong. Please try again.'}
          action={
            <Button asChild>
              <Link href="/catalog/import">Try again</Link>
            </Button>
          }
        />
      )}

      {run.status === 'cancelled' && (
        <EmptyState title="Import cancelled" description="Nothing was added to your catalog." />
      )}
    </div>
  );
}

function ImportSummary({
  run,
  items,
}: {
  run: { createdCount: number; updatedCount: number; failedCount: number; skippedCount: number };
  items: ImportItemView[];
}) {
  const failed = items.filter((i) => i.result === 'failed');
  const notes = items.filter((i) => i.result !== 'failed' && i.resultMessage);
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <p className="flex items-center gap-2 font-semibold text-success">
            <CheckCircle2 className="size-5" aria-hidden /> Import finished
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            <li>{plural(run.createdCount, 'new product added', 'new products added')}</li>
            {run.updatedCount > 0 && (
              <li>{plural(run.updatedCount, 'product updated', 'products updated')}</li>
            )}
            {run.skippedCount > 0 && (
              <li>{plural(run.skippedCount, 'product left out', 'products left out')}</li>
            )}
            {run.failedCount > 0 && (
              <li className="text-danger">
                {plural(
                  run.failedCount,
                  'product could not be saved',
                  'products could not be saved',
                )}
              </li>
            )}
          </ul>
          <Button asChild className="self-start">
            <Link href="/catalog">Go to catalog</Link>
          </Button>
        </CardContent>
      </Card>
      {(failed.length > 0 || notes.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Check these</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y text-sm">
              {[...failed, ...notes].map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 py-2">
                  <span className="font-medium">
                    {item.productId ? (
                      <Link
                        href={`/catalog/${item.productId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {item.data.name}
                      </Link>
                    ) : (
                      item.data.name
                    )}{' '}
                    <span className="font-normal text-muted-foreground">({item.sourceRef})</span>
                  </span>
                  <span className={item.result === 'failed' ? 'text-danger' : 'text-warning'}>
                    {item.resultMessage}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
