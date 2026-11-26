'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { STAFF_PASSWORD_MAX, dummyHash, verifyPassword } from '@/lib/auth/password';
import { createStaffSession, currentStaff, destroyStaffSession } from '@/lib/auth/staff-session';
import { normalisePhone } from '@/lib/parse/phone';
import { clientIpFromHeaders, limiters } from '@/lib/rate-limit';
import { getStorage } from '@/lib/storage';
import { isStaffNotReady } from '@/lib/storage/staff-errors';
import type { StaffAccountRecord } from '@/lib/types';

const LOGIN = '/team/login';

const loginSchema = z.object({
  phone: z.string().min(1).max(40),
  password: z.string().min(1).max(STAFF_PASSWORD_MAX),
});

type LoginOutcome = 'ok' | 'invalid' | 'unavailable';

/**
 * Staff login. One generic error for every failure (unknown phone, wrong password, disabled account, malformed form):
 * the answer never says which. The password is verified even when the phone is unknown, so the timing stays flat.
 * Nothing private (phone, password) goes into the URL, a log or a report.
 */
export async function staffLoginAction(formData: FormData): Promise<void> {
  const lim = limiters();
  const ip = clientIpFromHeaders(await headers());
  if (!lim.staffLogin.check(ip).ok) redirect(`${LOGIN}?error=rate`);

  const parsed = loginSchema.safeParse({ phone: formData.get('phone'), password: formData.get('password') });
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  // Second guard, keyed by the phone: a botnet changes IPs, the phone stays. (Accepted: someone can lock one phone out for 15 minutes.)
  if (phone && !lim.staffLoginPhone.check(phone).ok) redirect(`${LOGIN}?error=rate`);

  const storage = getStorage();
  if (!storage.staffByPhone) redirect(`${LOGIN}?error=unavailable`);

  // redirect() throws: decide inside the try, redirect after it.
  let outcome: LoginOutcome;
  let account: StaffAccountRecord | null = null;
  try {
    account = phone ? await storage.staffByPhone(phone) : null;
    const ok = await verifyPassword(parsed.success ? parsed.data.password : '', account?.passwordHash ?? (await dummyHash()));
    outcome = account && account.active && ok ? 'ok' : 'invalid';
  } catch (e) {
    if (!isStaffNotReady(e)) throw e;
    outcome = 'unavailable';
  }
  if (outcome !== 'ok' || !account) redirect(`${LOGIN}?error=${outcome === 'unavailable' ? 'unavailable' : '1'}`);

  try {
    await storage.staffTouchLogin?.(account.id, new Date().toISOString());
  } catch {
    // Best effort: the last-login time is informational.
  }
  await createStaffSession(account);
  redirect('/team');
}

export async function staffLogoutAction(): Promise<void> {
  // Move the session cutoff so a copy of this cookie stops working too (this ends the account's sessions on every device).
  const me = await currentStaff();
  if (me) {
    try {
      await getStorage().staffUpdate?.(me.id, { passwordChangedAt: new Date().toISOString() });
    } catch {
      // Best effort: the cookie is still deleted.
    }
  }
  await destroyStaffSession();
  redirect(LOGIN);
}
