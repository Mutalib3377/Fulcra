import { EmptyState } from '@fulcra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Catalog' };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Catalog</h1>
      <EmptyState
        title="No products yet"
        description="You will be able to add your products here soon."
      />
    </div>
  );
}
