import { Slot } from '@radix-ui/react-slot';
import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Grouped list (like iPhone Settings): a titled group of rows on one surface, separated by
 * hairlines that start after the icon.
 */
export function ListGroup({
  title,
  footer,
  className,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {title && (
        <h2 className="px-1 text-[0.8125rem] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
      )}
      <ul className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-card">
        {children}
      </ul>
      {footer && <div className="px-1 text-sm text-muted-foreground">{footer}</div>}
    </section>
  );
}

type ListRowProps = {
  /** Small coloured square with an icon, like iOS settings rows. */
  icon?: ReactNode;
  /** Required unless asChild (then the child holds a ListRowContent). */
  title?: ReactNode;
  description?: ReactNode;
  /** Shown on the right: a value, badge or switch. */
  trailing?: ReactNode;
  /** Shows a chevron (use for rows that open another page). */
  chevron?: boolean;
  /** Render as the child element (e.g. a Link) so the whole row is tappable. */
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentProps<'div'>, 'title' | 'children'>;

export function ListRow({
  icon,
  title,
  description,
  trailing,
  chevron = false,
  asChild = false,
  children,
  className,
  ...props
}: ListRowProps) {
  const body = (
    <ListRowContent
      icon={icon}
      title={title}
      description={description}
      trailing={trailing}
      chevron={chevron}
    />
  );
  const classes = cn(
    'flex min-h-12 items-center gap-3 pl-4 text-left',
    asChild && 'transition-colors hover:bg-muted/60 active:bg-muted',
    className,
  );
  return (
    <li className="group/row">
      {asChild ? (
        <Slot className={classes} {...props}>
          {children}
        </Slot>
      ) : (
        <div className={classes} {...props}>
          {body}
        </div>
      )}
    </li>
  );
}

/** Content for a ListRow used with asChild: `<ListRow asChild ...><Link href>…</Link></ListRow>`. */
export function ListRowContent(props: Omit<ListRowProps, 'asChild' | 'children' | 'className'>) {
  const { icon, title, description, trailing, chevron } = props;
  return (
    <>
      {icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[0.5rem] bg-primary-soft text-primary-soft-foreground [&_svg]:size-[1.125rem]">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b border-border/70 py-3 pr-4 group-last/row:border-0">
        <span className="flex min-w-[6.5rem] flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.9375rem] font-medium">{title}</span>
          {description && (
            <span className="line-clamp-2 text-sm text-muted-foreground">{description}</span>
          )}
        </span>
        {trailing && (
          <span className="flex min-w-0 max-w-[62%] justify-end truncate text-right text-[0.9375rem] text-muted-foreground">
            {trailing}
          </span>
        )}
        {chevron && <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />}
      </span>
    </>
  );
}
