'use client';

import { useId, type KeyboardEvent } from 'react';
import { cn } from '../lib/cn';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Read by screen readers, e.g. "Billing period". */
  label: string;
  className?: string;
};

/** Two to four mutually exclusive choices shown side by side (e.g. Monthly / Yearly). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
}: Props<T>) {
  const id = useId();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const move = (event: KeyboardEvent, step: number) => {
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length]!;
    onValueChange(next.value);
    document.getElementById(`${id}-${next.value}`)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('relative inline-grid rounded-full bg-muted p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-card shadow-[0_1px_3px_rgb(0_0_0/0.1),0_1px_1px_rgb(0_0_0/0.04)] transition-transform duration-250 ease-out"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${id}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') move(event, 1);
              if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') move(event, -1);
            }}
            className={cn(
              'relative z-10 h-9 rounded-full px-4 text-sm font-medium transition-colors duration-200',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
