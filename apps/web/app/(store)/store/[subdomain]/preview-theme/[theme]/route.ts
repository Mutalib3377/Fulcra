import { STORE_THEMES } from '@fulcra/core/rules';
import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_THEME_COOKIE } from '@/lib/store-themes';
import { storeUrl } from '@/lib/urls';

type Context = { params: Promise<{ subdomain: string; theme: string }> };

/**
 * "Preview my store in this theme" (Brand kit): shows the store in another theme on this phone
 * only, for an hour. /preview-theme/off goes back to the saved theme. Nothing is saved.
 */
export async function GET(_request: NextRequest, { params }: Context) {
  const { subdomain, theme } = await params;
  const response = NextResponse.redirect(storeUrl(subdomain, '/'), 303);
  if ((STORE_THEMES as readonly string[]).includes(theme)) {
    response.cookies.set(PREVIEW_THEME_COOKIE, theme, {
      path: '/',
      maxAge: 60 * 60,
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  } else {
    response.cookies.delete(PREVIEW_THEME_COOKIE);
  }
  return response;
}
