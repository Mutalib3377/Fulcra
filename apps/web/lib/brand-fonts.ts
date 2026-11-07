import type { BrandFont } from '@fulcra/core/rules';

/**
 * Brand font choices. Previews use fonts already on the phone (no download);
 * the storefront uses the same stacks, so cheap phones download no font files.
 */
export const brandFontOptions: Record<BrandFont, { label: string; stack: string }> = {
  clean: { label: 'Clean', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  modern: { label: 'Modern', stack: '"Helvetica Neue", Arial, sans-serif' },
  friendly: { label: 'Friendly', stack: '"Trebuchet MS", Verdana, sans-serif' },
  elegant: { label: 'Elegant', stack: 'Georgia, "Times New Roman", serif' },
  bold: { label: 'Bold', stack: '"Arial Black", "Helvetica Neue", Arial, sans-serif' },
};
