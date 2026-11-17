import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** Shared look for text fields, text areas and selects. */
export const fieldClasses = [
  // text-base (16px) stops iOS from zooming into the field on focus.
  'w-full rounded-md border border-input bg-card text-base text-foreground shadow-xs',
  'placeholder:text-subtle-foreground transition-[border-color,box-shadow] duration-150',
  'focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/15',
].join(' ');

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input type={type} className={cn(fieldClasses, 'flex h-11 px-3.5', className)} {...props} />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />;
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
