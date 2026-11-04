import { EmptyState } from '@fulcra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Orders</h1>
      <EmptyState
        title="No orders yet"
        description="Orders you record, and orders the assistant takes, will appear here."
      />
    </div>
  );
}
