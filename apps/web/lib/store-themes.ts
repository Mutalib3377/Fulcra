import type { BrandFont, StoreTheme } from '@fulcra/core/rules';
import { brandFontOptions } from './brand-fonts';

/**
 * Store themes (T1, docs/decisions/0026). A theme is a set of design choices on top of the
 * brand kit: page colours (CSS in globals.css, `data-store-theme`), corner style, hero layout,
 * product card shape and how many products sit side by side on a phone. Browser-safe: the
 * Brand kit picker draws its previews from the same table.
 */
export type ThemeHero = 'collage' | 'minimal' | 'split' | 'dark' | 'banner' | 'playful';
export type ThemeCard = 'portrait' | 'square' | 'tall' | 'framed' | 'compact' | 'soft';

export type StoreThemeOption = {
  label: string;
  description: string;
  /** Corners; null keeps the brand font's own. */
  radius: string | null;
  hero: ThemeHero;
  card: ThemeCard;
  /** Products side by side on a phone. */
  phoneColumns: 2 | 3;
  /** Colours of the small preview in the picker (page, card, text). */
  preview: { bg: string; surface: string; fg: string; dark?: boolean };
};

export const storeThemeOptions: Record<StoreTheme, StoreThemeOption> = {
  classic: {
    label: 'Classic',
    description: 'Your colours up top with a collage of your photos.',
    radius: null,
    hero: 'collage',
    card: 'portrait',
    phoneColumns: 2,
    preview: { bg: '#ffffff', surface: '#f4f4f5', fg: '#111827' },
  },
  minimal: {
    label: 'Minimal',
    description: 'White, calm and sharp. Big photos do the talking.',
    radius: '0.125rem',
    hero: 'minimal',
    card: 'square',
    phoneColumns: 2,
    preview: { bg: '#ffffff', surface: '#f5f5f5', fg: '#0a0a0a' },
  },
  boutique: {
    label: 'Boutique',
    description: 'Elegant, like a fashion magazine: one big photo, fine type.',
    radius: '0',
    hero: 'split',
    card: 'tall',
    phoneColumns: 2,
    preview: { bg: '#faf7f2', surface: '#efe9df', fg: '#1c1917' },
  },
  bold: {
    label: 'Bold',
    description: 'Dark and loud: huge type, bright buttons.',
    radius: '0.75rem',
    hero: 'dark',
    card: 'framed',
    phoneColumns: 2,
    preview: { bg: '#0b0b0f', surface: '#17171d', fg: '#fafafa', dark: true },
  },
  market: {
    label: 'Market',
    description: 'Straight to the products, three on a row. Great for many items.',
    radius: '0.75rem',
    hero: 'banner',
    card: 'compact',
    phoneColumns: 3,
    preview: { bg: '#f5f5f2', surface: '#ffffff', fg: '#111827' },
  },
  playful: {
    label: 'Playful',
    description: 'Soft colours and round shapes. Friendly and fun.',
    radius: '1.75rem',
    hero: 'playful',
    card: 'soft',
    phoneColumns: 2,
    preview: { bg: '#fffaf0', surface: '#fff1d6', fg: '#1f2937' },
  },
};

/** Heading style: the brand font, adjusted where a theme needs it. */
export function themeTypography(theme: StoreTheme, font: BrandFont) {
  const base = brandFontOptions[font];
  // Boutique keeps an elegant serif unless the seller picked a font other than the default.
  if (theme === 'boutique' && font === 'clean') {
    return { ...brandFontOptions.elegant, radius: base.radius };
  }
  if (theme === 'bold') return { ...base, weight: Math.max(base.weight, 820) };
  return base;
}

/** Cookie set by "Preview my store in this theme" (only on that shopper's phone). */
export const PREVIEW_THEME_COOKIE = 'fulcra_preview_theme';
