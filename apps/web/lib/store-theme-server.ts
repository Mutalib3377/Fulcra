import 'server-only';
import type { StoreInfo } from '@fulcra/core';
import { STORE_THEMES, type StoreTheme } from '@fulcra/core/rules';
import { cookies } from 'next/headers';
import { PREVIEW_THEME_COOKIE, storeThemeOptions, type StoreThemeOption } from './store-themes';

/**
 * The theme a store shows: the seller's saved theme, or the one they are previewing (a cookie
 * on their own phone, set by the Brand kit's preview link).
 */
export async function storeThemeFor(
  store: Pick<StoreInfo, 'brand'>,
): Promise<{ theme: StoreTheme; option: StoreThemeOption; preview: boolean }> {
  const previewing = (await cookies()).get(PREVIEW_THEME_COOKIE)?.value;
  const preview = (STORE_THEMES as readonly string[]).includes(previewing ?? '')
    ? (previewing as StoreTheme)
    : null;
  const theme = preview ?? store.brand.theme;
  return {
    theme,
    option: storeThemeOptions[theme],
    preview: preview !== null && preview !== store.brand.theme,
  };
}
