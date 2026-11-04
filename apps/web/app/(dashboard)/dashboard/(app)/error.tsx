'use client';

import { Button, ErrorState } from '@fulcra/ui';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      action={
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
