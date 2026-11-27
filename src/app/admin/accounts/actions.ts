'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appendSheetCost, parseIqd } from '@/lib/accounting/cost-entry';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';

/**
 * Saves a new cost per A4 sheet (paper, plastic) as a new entry that applies from now on. Redirects to
 * /admin/accounts?saved=1, or ?error=<code> (invalid | unchanged | tooMany | failed).
 */
export async function saveSheetCostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const paper = parseIqd(formData.get('paperCost'));
  const plastic = parseIqd(formData.get('plasticCost'));
  const storage = getStorage();
  // Straight from the adapter (not the request-cached getSettings() wrapper): this is a read-modify-write.
  const current = await storage.getSettings();
  const result = appendSheetCost(current, paper, plastic, new Date());
  if (!result.ok) redirect(`/admin/accounts?error=${result.error}`);
  await storage.saveSettings(result.settings);
  revalidatePath('/admin/accounts');
  redirect('/admin/accounts?saved=1');
}
