import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminEnv } from '@/lib/env';
import { reportError } from '@/lib/monitoring/report';
import { getStorage } from '@/lib/storage';
import { isStaffNotReady } from '@/lib/storage/staff-errors';
import type { StaffAccount, StaffAccountRecord } from '@/lib/types';
import {
  STAFF_COOKIE_NAME,
  STAFF_SESSION_TTL_SEC,
  signStaffToken,
  verifyStaffToken,
} from './staff-token';

const LOGIN_PATH = '/team/login';

/** The stored record without its password hash: the only form that may reach a page or a client component. */
export function toStaffAccount(rec: StaffAccountRecord): StaffAccount {
  return {
    id: rec.id,
    name: rec.name,
    phone: rec.phone,
    active: rec.active,
    createdAt: rec.createdAt,
    passwordChangedAt: rec.passwordChangedAt,
    ...(rec.lastLoginAt ? { lastLoginAt: rec.lastLoginAt } : {}),
  };
}

export async function createStaffSession(staff: Pick<StaffAccount, 'id'>): Promise<void> {
  const token = await signStaffToken(getAdminEnv().SESSION_SECRET, staff.id);
  const h = await headers();
  // Secure cookies only work over HTTPS; plain http on localhost / LAN must keep working.
  const secure = h.get('x-forwarded-proto') === 'https';
  // path '/' because both /team (pages) and /api/team (routes) read it.
  (await cookies()).set(STAFF_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: STAFF_SESSION_TTL_SEC,
  });
}

/**
 * The logged-in staff account, or null. Re-reads the account on every call (a disabled account is refused on its
 * next request) and fails closed: a storage outage or a missing table means "nobody".
 */
export async function currentStaff(): Promise<StaffAccount | null> {
  const token = (await cookies()).get(STAFF_COOKIE_NAME)?.value;
  const claims = await verifyStaffToken(token, process.env.SESSION_SECRET);
  if (!claims) return null;
  const storage = getStorage();
  if (!storage.staffGet) return null;
  let rec: StaffAccountRecord | null;
  try {
    rec = await storage.staffGet(claims.staffId);
  } catch (e) {
    if (!isStaffNotReady(e)) reportError(new Error('staff session lookup failed'), { where: 'staff.session' });
    return null;
  }
  if (!rec || !rec.active) return null;
  // `iat` is whole seconds, passwordChangedAt has milliseconds: compare in whole seconds, so a login made in the
  // same second as the account's creation or password reset is still valid. A NaN date is refused.
  const changedSec = Math.floor(Date.parse(rec.passwordChangedAt) / 1000);
  if (!(claims.iatSec >= changedSec)) return null;
  return toStaffAccount(rec);
}

/** For /team pages: sends anyone who is not logged in to the login page. */
export async function requireStaff(): Promise<StaffAccount> {
  const s = await currentStaff();
  if (!s) redirect(LOGIN_PATH);
  return s;
}

/** For /api/team route handlers: `{ staff }`, or the 401 JSON answer to return as is. */
export async function staffApiGuard(): Promise<{ staff: StaffAccount } | Response> {
  const staff = await currentStaff();
  if (staff) return { staff };
  return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}

export async function destroyStaffSession(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE_NAME);
}
