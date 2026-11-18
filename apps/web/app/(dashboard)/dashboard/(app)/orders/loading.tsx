import { Skeleton } from '@fulcra/ui';

/** Skeleton of the orders list: title, tabs, search, then rows. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading orders" className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-col gap-px overflow-hidden rounded-xl">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[4.5rem] rounded-none" />
        ))}
      </div>
    </div>
  );
}
