import { EmptyState } from '@fulcra/ui';

/** Shown for a store address that does not exist. */
export default function StoreNotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <EmptyState
        title="This store doesn't exist"
        description="Check the spelling of the link. If someone shared it with you, ask them to send it again."
      />
    </main>
  );
}
