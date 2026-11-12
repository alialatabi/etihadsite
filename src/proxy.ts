import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, verifyToken } from '@/lib/auth/token';
import { STAFF_KEY_HEADER, STAFF_PAGE_ROUTE, matchesStaffKey } from '@/lib/staff-gate';

/**
 * Protects /admin/* (except /admin/login) and /api/admin/*, and opens the hidden staff page
 * only for /staff/<the exact STAFF_PAGE_KEY> (see staffGate).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Everything the staff matchers let in starts with /staff (STAFF_PAGE_ROUTE too); the admin paths never do.
  if (pathname.startsWith('/staff')) return staffGate(request, pathname);
  if (pathname === '/admin/login') return NextResponse.next();

  const ok = await verifyToken(request.cookies.get(COOKIE_NAME)?.value, process.env.SESSION_SECRET);
  if (ok) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/admin/login', request.url));
}

/** A path no route matches: rewriting to it gives the page Next serves for an unknown URL. */
const NO_ROUTE = `${STAFF_PAGE_ROUTE}/not-found`;

/**
 * - `/staff/<right key>`: rewritten to the real page, with the key in a request header (the page
 *   checks it again) and privacy headers on the response.
 * - The real page's route asked for directly: rewritten to a path with no route (the normal 404).
 * - Anything else under /staff (wrong, missing or unset key, extra segments): passed through
 *   untouched. No route matches it, so Next answers exactly as for an unknown URL, headers included.
 */
function staffGate(request: NextRequest, pathname: string): NextResponse {
  const key = keySegment(pathname);
  if (key !== undefined && matchesStaffKey(key, process.env.STAFF_PAGE_KEY)) {
    const headers = new Headers(request.headers);
    headers.set(STAFF_KEY_HEADER, key);
    const res = NextResponse.rewrite(new URL(STAFF_PAGE_ROUTE, request.url), { request: { headers } });
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
  }
  if (pathname === STAFF_PAGE_ROUTE) return NextResponse.rewrite(new URL(NO_ROUTE, request.url));
  return NextResponse.next();
}

/** The decoded `<key>` of `/staff/<key>` (exactly one segment), or undefined for any other shape. */
function keySegment(pathname: string): string | undefined {
  const m = /^\/staff\/([^/]+)$/.exec(pathname);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}

export const config = {
  // '/staff-sheets' is STAFF_PAGE_ROUTE; matchers must be literals (tests/unit/server/staff-proxy.test.ts pins it).
  matcher: ['/admin/:path*', '/api/admin/:path*', '/staff/:path*', '/staff-sheets'],
};
