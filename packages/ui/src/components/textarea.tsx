import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { fieldClasses } from './input';

export function Textarea({ className, rows = 4, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={rows}
      className={cn(fieldClasses, 'flex px-3.5 py-2.5', className)}
      {...props}
    />
  );
}

/** Native select: light, accessible and uses the phone's own picker. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldClasses, 'flex h-11 px-3', className)} {...props} />;
}
