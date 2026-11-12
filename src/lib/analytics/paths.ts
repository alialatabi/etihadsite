/**
 * Paths that are never counted. Both checks ignore letter case: `/Staff/<key>` still carries the
 * secret key (the page itself is a 404 there), so it must not reach analytics either.
 */

/** `/staff` and everything under it: the staff page lives behind a secret link. */
export function isStaffPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === '/staff' || p.startsWith('/staff/');
}

/** `/admin` and everything under it. */
export function isAdminPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === '/admin' || p.startsWith('/admin/');
}
