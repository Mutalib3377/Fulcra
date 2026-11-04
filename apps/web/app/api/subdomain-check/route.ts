import { checkSubdomainAvailable } from '@fulcra/core';
import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

/** Live "is this store address free?" check for onboarding. Signed-in users only. */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) {
    return Response.json({ error: 'Please sign in.' }, { status: 401 });
  }
  const name = request.nextUrl.searchParams.get('name') ?? '';
  const result = await checkSubdomainAvailable(name.slice(0, 100));
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
