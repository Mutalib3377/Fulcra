import { NextResponse, type NextRequest } from 'next/server';
import { getRootDomain, resolveHost, rewritePath } from './lib/host-routing';

/**
 * Routes each request by host:
 *   yourdomain.com          → app/(marketing)
 *   app.yourdomain.com      → app/(dashboard)/dashboard
 *   <name>.yourdomain.com   → app/(store)/store/[subdomain]
 * Locally the same works with localhost:3000, app.localhost:3000 and <name>.localhost:3000.
 */
export function proxy(request: NextRequest) {
  const rootDomain = getRootDomain();
  const host = request.headers.get('host');
  const target = resolveHost(host, rootDomain);

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
  return NextResponse.rewrite(url, rewritten === '/404' ? { status: 404 } : undefined);
}

export const config = {
  // Skip API routes (webhooks, widget), Next.js internals and files with an extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
