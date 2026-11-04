import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

type StateProps = {
  title: string;
  description?: string;
  /** Usually a Button, e.g. "Add your first product" or "Try again". */
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

function StateLayout({ title, description, action, icon, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-10">{icon}</div>}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shown when a list or page has nothing in it yet. */
export function EmptyState({ icon = <Inbox aria-hidden />, ...props }: StateProps) {
  return <StateLayout icon={icon} {...props} />;
}

/** Shown when something failed to load. Always offer a way to retry. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'Please check your internet connection and try again.',
  icon = <AlertTriangle aria-hidden className="text-danger" />,
  ...props
}: Partial<StateProps>) {
  return (
    <div role="alert">
      <StateLayout title={title} description={description} icon={icon} {...props} />
    </div>
  );
}

/** Shown while content loads. */
export function LoadingState({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-center gap-2 py-12 text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Grey placeholder block for skeleton screens. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} />;
}
