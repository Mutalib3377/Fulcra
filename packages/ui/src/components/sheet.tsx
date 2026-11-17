'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/**
 * A panel for a focused task (confirm, pick, edit one thing). Slides up from the bottom on
 * phones and shows centred on larger screens. Built on the native <dialog>: focus is trapped,
 * Escape closes it, and the page behind cannot be used.
 */
export function Sheet({ open, onOpenChange, title, description, children, className }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        // A click on the backdrop (the dialog itself, outside the panel) closes it.
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      className={cn(
        'm-0 mt-auto w-full max-w-none bg-transparent p-0 text-foreground backdrop:bg-black/40 backdrop:backdrop-blur-[2px]',
        'sm:m-auto sm:max-w-md',
        'open:animate-sheet-in sm:open:animate-rise-in backdrop:open:animate-fade-in',
      )}
    >
      <div
        className={cn(
          'flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-raised p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-overlay sm:rounded-2xl sm:p-6',
          className,
        )}
      >
        <div aria-hidden className="mx-auto -mt-2 h-1 w-9 rounded-full bg-input sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
