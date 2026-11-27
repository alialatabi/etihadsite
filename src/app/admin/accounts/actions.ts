'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appendSheetCost, parseIqd } from '@/lib/accounting/cost-entry';
import { parseWeekKey } from '@/lib/accounting/week';
import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';

/**
 * Saves a new cost per A4 sheet (paper, plastic) as a new entry that applies from now on. Redirects to
 * /admin/accounts?saved=1, or ?error=<code> (invalid | unchanged | tooMany | failed). The week the owner was
 * looking at (hidden `week` field, validated) is kept in the redirect.
 */
export async function saveSheetCostAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const week = parseWeekKey(formData.get('week'));
  const back = week ? `/admin/accounts?week=${week}&` : '/admin/accounts?';
  const paper = parseIqd(formData.get('paperCost'));
  const plastic = parseIqd(formData.get('plasticCost'));
  const storage = getStorage();
  // Straight from the adapter (not the request-cached getSettings() wrapper): this is a read-modify-write.
  const current = await storage.getSettings();
  const result = appendSheetCost(current, paper, plastic, new Date());
  if (!result.ok) redirect(`${back}error=${result.error}`);
  await storage.saveSettings(result.settings);
  revalidatePath('/admin/accounts');
  redirect(`${back}saved=1`);
}
