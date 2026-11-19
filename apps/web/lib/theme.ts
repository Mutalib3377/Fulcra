/**
 * The dashboard's light / dark choice, kept in a cookie on the device (no account setting:
 * an owner may want dark on their phone and light on a shop computer). Browser-safe.
 */
export const THEME_COOKIE = 'fulcra-theme';
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Automatic',
  light: 'Light',
  dark: 'Dark',
};

export function parseTheme(value: string | undefined | null): Theme {
  return (THEMES as readonly string[]).includes(value ?? '') ? (value as Theme) : 'system';
}

/** The value for `data-color-scheme` (see the UI tokens). */
export function colorSchemeFor(theme: Theme): 'auto' | 'light' | 'dark' {
  return theme === 'system' ? 'auto' : theme;
}

/** Browser colour for the phone's status bar. */
export const THEME_COLOURS = { light: '#f6f6f8', dark: '#0e0e10' } as const;
