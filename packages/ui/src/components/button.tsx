import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium tracking-[-0.005em] whitespace-nowrap select-none',
    'transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        tinted: 'bg-primary-soft text-primary-soft-foreground hover:brightness-[0.97]',
        outline: 'border border-input bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'bg-danger text-white shadow-xs hover:brightness-95',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        // Default height is 44px: a comfortable tap target on phones.
        md: 'h-11 px-5 text-[0.9375rem]',
        sm: 'h-9 px-3.5 text-sm',
        lg: 'h-13 px-7 text-base',
        icon: 'size-11',
      },
      fullWidth: { true: 'w-full' },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render as the child element (e.g. a Next.js Link) with button styles. */
    asChild?: boolean;
    /** Shows a spinner and disables the button. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  fullWidth,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
