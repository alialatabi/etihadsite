/**
 * Paths that are never counted. Both checks ignore letter case: `/Staff/<key>` still carries the
 * secret key (the page itself is a 404 there), so it must not reach analytics either.
 */

/**
 * `/staff` and everything under it: the staff page lives behind a secret link. Also its real
 * route `/staff-sheets` (STAFF_PAGE_ROUTE in src/lib/staff-gate.ts, not imported here because that
 * module is server code), in case a router hook ever reports the rewritten path.
 */
export function isStaffPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === '/staff' || p.startsWith('/staff/') || p === '/staff-sheets' || p.startsWith('/staff-sheets/');
}

/** `/admin` and everything under it. */
export function isAdminPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === '/admin' || p.startsWith('/admin/');
}
