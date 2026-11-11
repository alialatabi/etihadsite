/** Paths that are never counted: the staff page lives behind a secret link that must not reach analytics. */
export function isStaffPath(path: string): boolean {
  return path === '/staff' || path.startsWith('/staff/');
}
