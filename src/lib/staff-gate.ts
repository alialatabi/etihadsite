/**
 * What src/proxy.ts and the staff page share: the key comparison, the page's real route and the
 * request header that carries the key from the proxy to the page.
 * No server-only / next imports so the proxy can use it (same rule as auth/token.ts).
 * The Next 16 proxy runs on the Node.js runtime, so node:crypto is available there.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** The secret link key is at least this long; anything shorter is treated as "not set". */
export const STAFF_KEY_MIN_LENGTH = 24;

/**
 * Where the staff page really lives (src/app/staff-sheets/page.tsx). The public link is
 * /staff/<key>: the proxy rewrites it here only for the right key, so /staff/<anything else>
 * matches no route at all and is answered exactly like an unknown URL. A direct request for
 * this route is turned into an unknown URL by the proxy too.
 */
export const STAFF_PAGE_ROUTE = '/staff-sheets';

/** Request header the proxy sets (overriding any sent by the browser) so the page can check the key again. */
export const STAFF_KEY_HEADER = 'x-staff-key';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** The configured key, or null when it is missing or shorter than STAFF_KEY_MIN_LENGTH. */
export function configuredStaffKey(value: string | undefined): string | null {
  return typeof value === 'string' && value.length >= STAFF_KEY_MIN_LENGTH ? value : null;
}

/**
 * True only for the exact (case-sensitive) key. `configured` is the raw STAFF_PAGE_KEY value;
 * a missing or short one never matches. Constant-time comparison of sha256 digests.
 */
export function matchesStaffKey(candidate: unknown, configured: string | undefined): boolean {
  const key = configuredStaffKey(configured);
  if (key === null || typeof candidate !== 'string') return false;
  return timingSafeEqual(digest(candidate), digest(key));
}
