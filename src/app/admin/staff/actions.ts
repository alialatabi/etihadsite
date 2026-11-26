'use server';

import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guard';
import { STAFF_PASSWORD_MAX, STAFF_PASSWORD_MIN, hashPassword } from '@/lib/auth/password';
import { normalisePhone } from '@/lib/parse/phone';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import { isStaffNotReady, isStaffPhoneTaken } from '@/lib/storage/staff-errors';

const PAGE = '/admin/staff';

/** The messages of admin.staff the page can show for `?error=`. */
type StaffError = 'phoneTaken' | 'invalid' | 'notReady';

const fail = (e: StaffError): never => redirect(`${PAGE}?error=${e}`);
const done = (): never => {
  revalidatePath(PAGE);
  return redirect(`${PAGE}?saved=1`);
};

const password = z.string().min(STAFF_PASSWORD_MIN).max(STAFF_PASSWORD_MAX);

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  phone: z.string().max(40),
  password,
});
const toggleSchema = z.object({ id: z.string().regex(ID_RE), active: z.enum(['true', 'false']) });
const resetSchema = z.object({ id: z.string().regex(ID_RE), password });

/** Maps a storage error to the page's error key; anything unexpected is rethrown. */
function mapStorageError(e: unknown): StaffError {
  if (isStaffPhoneTaken(e)) return 'phoneTaken';
  if (isStaffNotReady(e)) return 'notReady';
  throw e;
}

// redirect() throws NEXT_REDIRECT: every action decides inside its try / catch and redirects only after it.

export async function createStaffAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = createSchema.safeParse({
    name: formData.get('name'),
    phone: formData.get('phone'),
    password: formData.get('password'),
  });
  const phone = parsed.success ? normalisePhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return fail('invalid');
  const storage = getStorage();
  if (!storage.staffCreate || !storage.staffByPhone) return fail('notReady');

  let error: StaffError | null = null;
  try {
    if (await storage.staffByPhone(phone)) {
      error = 'phoneTaken';
    } else {
      const now = new Date().toISOString();
      await storage.staffCreate({
        id: nanoid(),
        name: parsed.data.name,
        phone,
        active: true,
        createdAt: now,
        passwordChangedAt: now,
        passwordHash: await hashPassword(parsed.data.password),
      });
    }
  } catch (e) {
    // Also covers two admins adding the same phone at once (the unique constraint answers 'phone taken').
    error = mapStorageError(e);
  }
  if (error) return fail(error);
  return done();
}

export async function setStaffActiveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = toggleSchema.safeParse({ id: formData.get('id'), active: formData.get('active') });
  if (!parsed.success) return fail('invalid');
  const storage = getStorage();
  if (!storage.staffUpdate) return fail('notReady');

  let error: StaffError | null = null;
  try {
    // A disabled account is refused on its very next request: currentStaff() re-reads the account every time.
    // Disabling also moves the session cutoff (passwordChangedAt) to now, so every cookie issued before it stays
    // dead after a later re-enable: the person has to log in again.
    const active = parsed.data.active === 'true';
    const updated = await storage.staffUpdate(
      parsed.data.id,
      active ? { active: true } : { active: false, passwordChangedAt: new Date().toISOString() },
    );
    if (!updated) error = 'invalid';
  } catch (e) {
    error = mapStorageError(e);
  }
  if (error) return fail(error);
  return done();
}

export async function resetStaffPasswordAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = resetSchema.safeParse({ id: formData.get('id'), password: formData.get('password') });
  if (!parsed.success) return fail('invalid');
  const storage = getStorage();
  if (!storage.staffUpdate) return fail('notReady');

  let error: StaffError | null = null;
  try {
    // passwordChangedAt = now logs out every existing session of the account.
    const updated = await storage.staffUpdate(parsed.data.id, {
      passwordHash: await hashPassword(parsed.data.password),
      passwordChangedAt: new Date().toISOString(),
    });
    if (!updated) error = 'invalid';
  } catch (e) {
    error = mapStorageError(e);
  }
  if (error) return fail(error);
  return done();
}
