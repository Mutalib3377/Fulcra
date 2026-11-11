import { getInstagramAppConfig, instagramAuthorizeUrl } from '@fulcra/channels';
import { createSignedState } from '@fulcra/core';
import { NextResponse } from 'next/server';
import { getActionContext } from '@/lib/auth';
import { INSTAGRAM_COOKIE_PATH, INSTAGRAM_NONCE_COOKIE } from '@/lib/instagram';
import { dashboardUrl } from '@/lib/urls';

const back = (error: string) =>
  NextResponse.redirect(dashboardUrl(`/settings/instagram?error=${error}`), 303);

/** Step 1 of "Connect Instagram": send the owner to Instagram to log in and allow messaging. */
export async function GET() {
  const context = await getActionContext();
  if (!context) return NextResponse.redirect(dashboardUrl('/sign-in'), 303);
  if (context.membership.role !== 'owner') return back('not_allowed');
  const config = getInstagramAppConfig();
  if (!config) return back('not_set_up');
  const { state, nonce } = createSignedState(
    { businessId: context.actor.businessId, userId: context.actor.userId },
    config.appSecret,
  );
  const response = NextResponse.redirect(
    instagramAuthorizeUrl({
      appId: config.appId,
      redirectUri: dashboardUrl('/api/integrations/instagram/callback'),
      state,
    }),
    303,
  );
  response.cookies.set(INSTAGRAM_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: dashboardUrl('/').startsWith('https:'),
    path: INSTAGRAM_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
