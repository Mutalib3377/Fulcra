import { NextResponse, type NextRequest } from 'next/server';
import { getRootDomain, resolveHost, rewritePath } from './lib/host-routing';
import { refreshSession } from './lib/supabase/proxy';

/**
 * Routes each request by host:
 *   yourdomain.com          → app/(marketing)
 *   app.yourdomain.com      → app/(dashboard)/dashboard   (also refreshes the login session)
 *   <name>.yourdomain.com   → app/(store)/store/[subdomain]
 * Locally the same works with localhost:3000, app.localhost:3000 and <name>.localhost:3000.
 */
export async function proxy(request: NextRequest) {
  const rootDomain = getRootDomain();
  const target = resolveHost(request.headers.get('host'), rootDomain);

  if (target.kind === 'redirect-root') {
    const { pathname, search } = request.nextUrl;
    const protocol = rootDomain.startsWith('localhost') ? 'http:' : 'https:';
    return NextResponse.redirect(
      new URL(`${pathname}${search}`, `${protocol}//${rootDomain}`),
      308,
    );
  }

  const rewritten =
    target.kind === 'not-found' ? '/404' : rewritePath(target, request.nextUrl.pathname);
  if (rewritten === null) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = rewritten;
  const status = rewritten === '/404' ? 404 : undefined;
  const makeResponse = () =>
    NextResponse.rewrite(url, { status, request: { headers: request.headers } });

  if (target.kind === 'dashboard') return refreshSession(request, makeResponse);
  return makeResponse();
}

export const config = {
  // Skip API routes (webhooks, widget), Next.js internals and files with an extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
