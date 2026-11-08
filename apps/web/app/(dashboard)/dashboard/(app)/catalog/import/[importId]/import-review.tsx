'use client';

import { Badge, Button, Card, cn } from '@fulcra/ui';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useOptimistic, useState, useTransition } from 'react';
import { goTo } from '@/lib/navigation';
import { cancelImportAction, confirmImportAction, setImportItemsDecisionAction } from '../actions';

export type ReviewItem = {
  id: string;
  name: string;
  sourceRef: string;
  priceLabel: string;
  details: string;
  errors: string[];
  warnings: string[];
  approved: boolean;
};

type Update = { ids: string[] | 'all'; approved: boolean };

/** Tick the products to bring in. Products with errors cannot be ticked until the file is fixed. */
export function ImportReview({
  importId,
  items,
  fromFile,
}: {
  importId: string;
  items: ReviewItem[];
  /** CSV files can be fixed and uploaded again; website products are fixed on the website. */
  fromFile: boolean;
}) {
  const [state, setState] = useState(items);
  const [optimistic, apply] = useOptimistic(state, (current, update: Update) =>
    current.map((item) =>
      (update.ids === 'all' || update.ids.includes(item.id)) && item.errors.length === 0
        ? { ...item, approved: update.approved }
        : item,
    ),
  );
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  const update = (u: Update) =>
    startTransition(async () => {
      setError(null);
      apply(u);
      const result = await setImportItemsDecisionAction(
        importId,
        u.approved,
        u.ids === 'all' ? undefined : u.ids,
      );
      if (!result.ok) return setError(result.message);
      setState((current) =>
        current.map((item) =>
          (u.ids === 'all' || u.ids.includes(item.id)) && item.errors.length === 0
            ? { ...item, approved: u.approved }
            : item,
        ),
      );
    });

  const ticked = optimistic.filter((i) => i.approved).length;
  const withErrors = optimistic.filter((i) => i.errors.length > 0).length;
  const withWarnings = optimistic.filter(
    (i) => i.errors.length === 0 && i.warnings.length > 0,
  ).length;
  const shown = onlyProblems
    ? optimistic.filter((i) => i.errors.length > 0 || i.warnings.length > 0)
    : optimistic;

  return (
    <div className="flex flex-col gap-4 pb-40 md:pb-24">
      <Card className="flex flex-col gap-2 p-4">
        <p className="font-semibold">
          We found {items.length} {items.length === 1 ? 'product' : 'products'}.
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>{items.length - withErrors} ready to import</li>
          {withErrors > 0 && (
            <li className="text-danger">
              {withErrors} {fromFile ? 'need fixing in your file first' : 'could not be read fully'}{' '}
              (they are left out)
            </li>
          )}
          {withWarnings > 0 && <li className="text-warning">{withWarnings} with notes to check</li>}
        </ul>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => update({ ids: 'all', approved: true })}
            disabled={pending}
          >
            Tick all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => update({ ids: 'all', approved: false })}
            disabled={pending}
          >
            Untick all
          </Button>
          {(withErrors > 0 || withWarnings > 0) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOnlyProblems((v) => !v)}
            >
              {onlyProblems ? 'Show all products' : 'Show only products with notes'}
            </Button>
          )}
        </div>
      </Card>

      <ul className="flex flex-col gap-2">
        {shown.map((item) => {
          const blocked = item.errors.length > 0;
          return (
            <li key={item.id}>
              <label
                className={cn(
                  'flex gap-3 rounded-lg border bg-card p-3',
                  blocked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer',
                  item.approved && 'border-primary/60',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-primary"
                  checked={item.approved}
                  disabled={blocked}
                  onChange={(e) => update({ ids: [item.id], approved: e.target.checked })}
                  aria-describedby={`item-${item.id}-notes`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium break-words">{item.name || 'No name'}</span>
                    <span className="shrink-0 text-sm font-semibold">{item.priceLabel}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {item.sourceRef}
                    {item.details ? ` · ${item.details}` : ''}
                  </span>
                  <div id={`item-${item.id}-notes`} className="flex flex-col gap-1">
                    {item.errors.map((message) => (
                      <p key={message} className="flex gap-1.5 text-sm text-danger">
                        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {message}
                      </p>
                    ))}
                    {item.warnings.map((message) => (
                      <p key={message} className="flex gap-1.5 text-sm text-warning">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {message}
                      </p>
                    ))}
                  </div>
                </div>
                {blocked && (
                  <Badge tone="danger" className="h-fit">
                    {fromFile ? 'Fix in file' : 'Left out'}
                  </Badge>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:left-60">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              loading={saving}
              disabled={ticked === 0 || pending}
              onClick={() =>
                startSaving(async () => {
                  setError(null);
                  const result = await confirmImportAction(importId);
                  if (!result.ok) setError(result.message);
                  else goTo(`/catalog/import/${importId}`);
                })
              }
            >
              Import {ticked} {ticked === 1 ? 'product' : 'products'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() =>
                startSaving(async () => {
                  const result = await cancelImportAction(importId);
                  if (result.ok) goTo(result.data.redirectTo);
                  else setError(result.message);
                })
              }
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
