import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        // text-base (16px) stops iOS from zooming into the field on focus.
        'flex h-11 w-full rounded-md border border-input bg-card px-3 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />;
}

/** Help text or an error message under a field. */
export function FieldMessage({
  className,
  error = false,
  ...props
}: ComponentProps<'p'> & { error?: boolean }) {
  return (
    <p
      role={error ? 'alert' : undefined}
      className={cn('text-sm', error ? 'text-danger' : 'text-muted-foreground', className)}
      {...props}
    />
  );
}
