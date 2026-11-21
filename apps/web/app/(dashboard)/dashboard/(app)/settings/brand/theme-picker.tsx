'use client';

import { STORE_THEMES, type StoreTheme } from '@fulcra/core/rules';
import { cn } from '@fulcra/ui';
import { Check, ExternalLink } from 'lucide-react';
import type { CSSProperties } from 'react';
import { storeThemeOptions, type StoreThemeOption } from '@/lib/store-themes';

/**
 * Settings → Brand kit: the six store themes (T1), each drawn as a tiny store in the seller's
 * own colours, plus a link to see their real store in the chosen theme before saving.
 */
export function ThemePicker({
  value,
  onChange,
  primaryColour,
  accentColour,
  storeAddress,
  disabled,
}: {
  value: StoreTheme;
  onChange: (theme: StoreTheme) => void;
  primaryColour: string;
  accentColour: string;
  /** e.g. https://adaeze.yourdomain.com; null when the seller uses their own website. */
  storeAddress: string | null;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Store theme"
      >
        {STORE_THEMES.map((key) => {
          const option = storeThemeOptions[key];
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(key)}
              className={cn(
                'relative flex flex-col gap-2 rounded-xl p-2 text-left ring-1 transition-shadow',
                selected ? 'ring-2 ring-primary' : 'ring-border hover:ring-input',
              )}
            >
              <MiniStore option={option} primary={primaryColour} accent={accentColour} />
              <span className="px-1">
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="block text-xs leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </span>
              {selected ? (
                <span className="absolute top-3.5 right-3.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                  <Check className="size-3.5" aria-hidden />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {storeAddress ? (
        <a
          href={`${storeAddress}/preview-theme/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary"
        >
          Preview my store in {storeThemeOptions[value].label}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}
      {storeAddress ? (
        <p className="text-xs text-muted-foreground">
          The preview uses your saved colours and only you can see it. Save to show the theme to
          customers.
        </p>
      ) : null}
    </div>
  );
}

/** A tiny drawing of a store in this theme (no images, just shapes). */
function MiniStore({
  option,
  primary,
  accent,
}: {
  option: StoreThemeOption;
  primary: string;
  accent: string;
}) {
  const { bg, surface, fg } = option.preview;
  const r =
    option.radius === null
      ? '6px'
      : option.radius === '0'
        ? '0'
        : option.radius === '1.75rem'
          ? '10px'
          : option.radius === '0.125rem'
            ? '1px'
            : '4px';
  const tile = (key: number, extra: CSSProperties = {}) => (
    <span
      key={key}
      className="block aspect-square"
      style={{ backgroundColor: surface, borderRadius: r, ...extra }}
    />
  );
  const line = (w: string, color = fg, h = 4, o = 1) => (
    <span
      className="block"
      style={{ width: w, height: h, backgroundColor: color, opacity: o, borderRadius: 2 }}
    />
  );
  return (
    <span
      aria-hidden
      className="flex aspect-[4/5] w-full flex-col overflow-hidden rounded-lg ring-1 ring-black/5"
      style={{ backgroundColor: bg }}
    >
      {option.hero === 'collage' ? (
        <span
          className="flex items-end justify-between gap-2 p-2.5"
          style={{ backgroundColor: primary, height: '44%' }}
        >
          <span className="flex flex-col gap-1.5">
            {line('46px', '#fff', 6)}
            {line('30px', '#fff', 3, 0.7)}
            <span className="mt-1 block h-2.5 w-9 rounded-full bg-[#1f8f4e]" />
          </span>
          <span className="relative h-12 w-12">
            <span className="absolute right-3 bottom-0 block h-10 w-8 -rotate-6 rounded bg-white/90" />
            <span className="absolute right-0 bottom-1 block h-10 w-8 rotate-6 rounded bg-white" />
          </span>
        </span>
      ) : option.hero === 'minimal' ? (
        <span
          className="flex flex-col items-center gap-1.5 px-2.5 pt-4 pb-2"
          style={{ height: '44%' }}
        >
          {line('60%', fg, 6)}
          {line('40%', fg, 3, 0.4)}
          <span className="mt-1 block h-2.5 w-10 rounded-full bg-[#1f8f4e]" />
        </span>
      ) : option.hero === 'split' ? (
        <span className="flex gap-2 p-2" style={{ height: '44%' }}>
          <span className="flex flex-1 flex-col justify-center gap-1.5">
            {line('80%', fg, 6)}
            {line('20px', fg, 1)}
            {line('60%', fg, 3, 0.4)}
            <span className="mt-1 block h-2.5 w-10" style={{ backgroundColor: fg }} />
          </span>
          <span className="block w-[45%]" style={{ backgroundColor: surface }} />
        </span>
      ) : option.hero === 'dark' ? (
        <span
          className="flex flex-col justify-end gap-1.5 p-2.5"
          style={{
            height: '44%',
            background: `radial-gradient(80% 70% at 90% 0%, ${primary}88, transparent 70%)`,
          }}
        >
          {line('80%', fg, 9)}
          <span className="block h-1.5 w-8 rounded-full" style={{ backgroundColor: primary }} />
          <span
            className="mt-0.5 block h-2.5 w-10 rounded-full"
            style={{ backgroundColor: primary }}
          />
        </span>
      ) : option.hero === 'banner' ? (
        <span className="flex items-center gap-1.5 px-2 py-2" style={{ backgroundColor: primary }}>
          <span className="block size-4 rounded bg-white/90" />
          {line('40%', '#fff', 5)}
        </span>
      ) : (
        <span
          className="relative flex flex-col items-center gap-1.5 overflow-hidden px-2 pt-3 pb-2"
          style={{ height: '44%' }}
        >
          <span
            className="absolute -top-4 -left-4 block size-12 rounded-full"
            style={{ backgroundColor: `${primary}33` }}
          />
          <span
            className="absolute top-3 -right-4 block size-12 rounded-full"
            style={{ backgroundColor: `${accent}55` }}
          />
          <span
            className="block size-9 rounded-full border-2 border-white"
            style={{ backgroundColor: surface }}
          />
          {line('50%', fg, 5)}
          <span className="block h-2.5 w-10 rounded-full bg-[#1f8f4e]" />
        </span>
      )}
      <span
        className={cn(
          'grid flex-1 content-start gap-1.5 p-2',
          option.phoneColumns === 3 ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        {Array.from({ length: option.phoneColumns === 3 ? 6 : 4 }, (_, i) =>
          tile(i, option.card === 'framed' ? { outline: `1px solid ${fg}22` } : {}),
        )}
      </span>
    </span>
  );
}
