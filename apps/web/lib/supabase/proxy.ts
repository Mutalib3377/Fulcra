import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseEnv } from './env';

/**
 * Refreshes the Supabase session cookie on dashboard requests.
 * `makeResponse` must forward `request.headers` so updated cookies reach the page.
 */
export async function refreshSession(
  request: NextRequest,
  makeResponse: () => NextResponse,
): Promise<NextResponse> {
  let response = makeResponse();
  const { url, key } = getSupabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = makeResponse();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Validates the session and rotates the token when needed.
  await supabase.auth.getClaims();
  return response;
}
