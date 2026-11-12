import 'server-only';
import { configuredStaffKey, matchesStaffKey } from './staff-gate';

export { STAFF_KEY_MIN_LENGTH } from './staff-gate';

/** True only for the exact (case-sensitive) staff key. Constant-time comparison of sha256 digests. */
export function isStaffKey(candidate: string | null | undefined): boolean {
  return matchesStaffKey(candidate, process.env.STAFF_PAGE_KEY);
}

/** `/staff/<key>`, or null when the staff page is not configured. */
export function staffPagePath(): string | null {
  const key = configuredStaffKey(process.env.STAFF_PAGE_KEY);
  return key === null ? null : `/staff/${encodeURIComponent(key)}`;
}
