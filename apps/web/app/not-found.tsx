import { EmptyState } from '@fulcra/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        title="Page not found"
        description="The link may be wrong, or this page no longer exists."
      />
    </main>
  );
}
