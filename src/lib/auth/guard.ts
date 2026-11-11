import 'server-only';
import { redirect } from 'next/navigation';
import { verifySession } from './session';

const ADMIN_LOGIN_PATH = '/admin/login';

/**
 * Session check for admin pages and server actions: sends anyone who is not logged in to
 * the login page. Call it as the first statement. The proxy already guards /admin, this is
 * the second, per-page check. Route handlers use adminApiGuard() from ./session instead.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await verifySession())) redirect(ADMIN_LOGIN_PATH);
}
