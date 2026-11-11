import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/** The secret link key is at least this long; anything shorter is treated as "not set". */
export const STAFF_KEY_MIN_LENGTH = 24;

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** The configured key, or null when STAFF_PAGE_KEY is missing or too short. */
function configuredKey(): string | null {
  const key = process.env.STAFF_PAGE_KEY;
  return key && key.length >= STAFF_KEY_MIN_LENGTH ? key : null;
}

/** True only for the exact (case-sensitive) staff key. Constant-time comparison of sha256 digests. */
export function isStaffKey(candidate: string | undefined): boolean {
  const key = configuredKey();
  if (key === null || typeof candidate !== 'string') return false;
  return timingSafeEqual(digest(candidate), digest(key));
}

/** `/staff/<key>`, or null when the staff page is not configured. */
export function staffPagePath(): string | null {
  const key = configuredKey();
  return key === null ? null : `/staff/${encodeURIComponent(key)}`;
}
