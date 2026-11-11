import {
  exchangeInstagramCode,
  getInstagramAppConfig,
  InstagramApiError,
  subscribeInstagramApp,
} from '@fulcra/channels';
import { isCoreError, readSignedState, saveInstagramConnection } from '@fulcra/core';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { INSTAGRAM_COOKIE_PATH, INSTAGRAM_NONCE_COOKIE } from '@/lib/instagram';
import { dashboardUrl } from '@/lib/urls';

/**
 * Step 2: Instagram sends the owner back with a one-time code. We check our signed state and
 * the browser cookie, swap the code for a 60-day token, ask Instagram to send this
 * account's DMs to us, and save the connection (token encrypted).
 */
export async function GET(request: Request) {
  const done = (query: string) => {
    const response = NextResponse.redirect(dashboardUrl(`/settings/instagram?${query}`), 303);
    response.cookies.delete({ name: INSTAGRAM_NONCE_COOKIE, path: INSTAGRAM_COOKIE_PATH });
    return response;
  };
  const config = getInstagramAppConfig();
  if (!config) return done('error=not_set_up');
  const query = new URL(request.url).searchParams;
  if (query.get('error')) return done('error=cancelled');

  const state = readSignedState<{ businessId: string; userId: string }>(
    query.get('state') ?? '',
    config.appSecret,
  );
  const nonce = request.headers
    .get('cookie')
    ?.match(new RegExp(`${INSTAGRAM_NONCE_COOKIE}=([0-9a-f]+)`))?.[1];
  const user = await getCurrentUser();
  if (!state || !nonce || state.nonce !== nonce || user?.id !== state.userId) {
    return done('error=failed');
  }
  try {
    const account = await exchangeInstagramCode({
      code: query.get('code') ?? '',
      redirectUri: dashboardUrl('/api/integrations/instagram/callback'),
      config,
    });
    await subscribeInstagramApp(account.accessToken);
    await saveInstagramConnection(
      { businessId: state.businessId, userId: state.userId },
      {
        accountId: account.accountId,
        username: account.username,
        accessToken: account.accessToken,
        expiresAt: account.expiresAt,
      },
    );
  } catch (error) {
    if (isCoreError(error) && error.code === 'conflict') return done('error=taken');
    if (error instanceof InstagramApiError || isCoreError(error)) {
      console.error('[instagram] connect failed', error.message);
      return done('error=failed');
    }
    throw error;
  }
  return done('connected=1');
}
