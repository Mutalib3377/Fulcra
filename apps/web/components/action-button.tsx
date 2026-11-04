'use client';

import { Button, type ButtonProps } from '@fulcra/ui';
import { useTransition } from 'react';
import { goTo } from '@/lib/navigation';

type ActionButtonProps = Omit<ButtonProps, 'onClick' | 'asChild'> & {
  action: () => Promise<unknown>;
  /** Where to go once the action has finished. */
  redirectTo: string;
};

/** Runs a Server Action, then navigates (see lib/navigation.ts for why). */
export function ActionButton({ action, redirectTo, ...props }: ActionButtonProps) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          await action();
          goTo(redirectTo);
        })
      }
      {...props}
    />
  );
}
