'use client';

import { Switch } from '@fulcra/ui';
import { useOptimistic, useTransition } from 'react';
import { setProductActiveAction } from './actions';

/** Show/hide a product from the list. Updates instantly, rolls back on failure. */
export function ActiveToggle({
  productId,
  isActive,
  name,
}: {
  productId: string;
  isActive: boolean;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(isActive);
  return (
    <Switch
      checked={checked}
      disabled={pending}
      aria-label={`Show ${name} to customers`}
      onCheckedChange={(next) =>
        startTransition(async () => {
          setChecked(next);
          const result = await setProductActiveAction(productId, next);
          if (!result.ok) window.alert(result.message);
        })
      }
    />
  );
}
