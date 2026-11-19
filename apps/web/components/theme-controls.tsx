'use client';

import { Button, SegmentedControl } from '@fulcra/ui';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  colorSchemeFor,
  parseTheme,
  THEME_COLOURS,
  THEME_COOKIE,
  THEME_LABELS,
  THEMES,
  type Theme,
} from '@/lib/theme';

const EVENT = 'fulcra-theme';
const YEAR = 60 * 60 * 24 * 365;

function readTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  return parseTheme(match?.[1]);
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Saves the choice and applies it at once (no reload). */
export function setTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${YEAR}; samesite=lax`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-color-scheme]'))
    el.dataset.colorScheme = colorSchemeFor(theme);
  window.dispatchEvent(new Event(EVENT));
}

function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => initial);
}

/** Whether the phone itself is set to dark (for "Automatic"). */
function usePhoneDark(): boolean | null {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDark(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return dark;
}

/** Keeps the browser's status bar colour in step with the theme. */
function useStatusBar(dark: boolean | null) {
  useEffect(() => {
    if (dark === null) return;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
      meta.setAttribute('content', dark ? THEME_COLOURS.dark : THEME_COLOURS.light);
  }, [dark]);
}

/** Settings → Appearance: Automatic / Light / Dark. */
export function ThemeChoice({ initial }: { initial: Theme }) {
  const theme = useTheme(initial);
  const phoneDark = usePhoneDark();
  useStatusBar(theme === 'system' ? phoneDark : theme === 'dark');
  return (
    <SegmentedControl
      label="Appearance"
      options={THEMES.map((value) => ({ value, label: THEME_LABELS[value] }))}
      value={theme}
      onValueChange={setTheme}
      className="w-full sm:w-80"
    />
  );
}

/** The sun / moon button in the header: switches to the other look straight away. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const theme = useTheme(initial);
  const phoneDark = usePhoneDark();
  const dark = theme === 'system' ? phoneDark : theme === 'dark';
  useStatusBar(dark);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      // Until the phone's setting is known, show nothing that could be wrong.
      className={dark === null ? 'invisible' : undefined}
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
