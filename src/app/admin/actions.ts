'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guard';
import { checkPassword, createSession, destroySession } from '@/lib/auth/session';
import { clientIpFromHeaders, limiters } from '@/lib/rate-limit';
import { getStorage } from '@/lib/storage';
import { ID_RE } from '@/lib/storage/paths';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/types';
import { parseSettingsForm } from './settings/parse-form';

export async function loginAction(formData: FormData): Promise<void> {
  const ip = clientIpFromHeaders(await headers());
  if (!limiters().login.check(ip).ok) redirect('/admin/login?error=rate');
  const password = formData.get('password');
  if (typeof password !== 'string' || !checkPassword(password)) redirect('/admin/login?error=1');
  await createSession();
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/admin/login');
}

const isOrderStatus = (v: string): v is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(v);

export async function updateOrderStatus(formData: FormData): Promise<void> {
  await requireAdmin();
  const orderId = String(formData.get('orderId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!ID_RE.test(orderId) || !isOrderStatus(status)) redirect('/admin');
  await getStorage().updateOrder(orderId, { status });
  revalidatePath('/admin');
  redirect(`/admin/orders/${orderId}?updated=1`);
}

export interface SettingsFormState {
  error?: string;
}

export async function saveSettingsAction(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  await requireAdmin();
  const storage = getStorage();
  // Read straight from the adapter: the request-cached getSettings() wrapper (@/lib/settings)
  // must never be used before a save.
  const current = await storage.getSettings();
  const parsed = parseSettingsForm(formData, current);
  if (!parsed.ok) return { error: parsed.error };
  await storage.saveSettings(parsed.settings);
  revalidatePath('/', 'layout');
  redirect('/admin/settings?saved=1');
}
