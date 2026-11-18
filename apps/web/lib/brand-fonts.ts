import type { BrandFont } from '@fulcra/core/rules';

/**
 * Brand font choices. Every store uses Inter for body text (self-hosted, already loaded by
 * every page); the choice sets the headings: font, weight, letter spacing and how round the
 * corners are, so stores look different without downloading more font files.
 */
export const brandFontOptions: Record<
  BrandFont,
  { label: string; stack: string; weight: number; tracking: string; radius: string }
> = {
  clean: {
    label: 'Clean',
    stack: 'Inter, system-ui, sans-serif',
    weight: 650,
    tracking: '-0.025em',
    radius: '1rem',
  },
  modern: {
    label: 'Modern',
    stack: 'Inter, system-ui, sans-serif',
    weight: 760,
    tracking: '-0.04em',
    radius: '0.5rem',
  },
  friendly: {
    label: 'Friendly',
    stack: 'Inter, system-ui, sans-serif',
    weight: 680,
    tracking: '-0.015em',
    radius: '1.5rem',
  },
  elegant: {
    label: 'Elegant',
    stack: 'Georgia, "Times New Roman", serif',
    weight: 500,
    tracking: '-0.015em',
    radius: '0.25rem',
  },
  bold: {
    label: 'Bold',
    stack: 'Inter, system-ui, sans-serif',
    weight: 850,
    tracking: '-0.045em',
    radius: '0.75rem',
  },
};
