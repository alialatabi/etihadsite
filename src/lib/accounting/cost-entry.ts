/** Adding a sheet-cost entry to the settings. Pure (the action does the session check, the read and the save). */
import { MAX_SHEET_COST_ENTRIES, shopSettingsSchema } from '@/lib/storage/settings-schema';
import type { ShopSettings } from '@/lib/types';
import { normaliseDigits } from '@/lib/parse/digits';
import { currentCost } from './costs';

export type SheetCostError = 'invalid' | 'unchanged' | 'tooMany' | 'failed';
export type AppendCostResult = { ok: true; settings: ShopSettings } | { ok: false; error: SheetCostError };

const MAX_IQD = 100_000_000;

/** A whole-dinar amount typed in the form, or NaN. */
export function parseIqd(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string') return NaN;
  const v = normaliseDigits(value.trim()).replace(/[,،٬\s]/g, '');
  if (!/^\d{1,9}$/.test(v)) return NaN;
  return Number(v);
}

/**
 * Appends { from: now, paperIqd, plasticIqd } to settings.accounting.sheetCosts. Old entries are never
 * dropped (past weeks are priced by them): at the limit this fails instead. An entry equal to the one in
 * force is skipped ('unchanged'). The whole result goes through the settings schema, because a stored
 * blob that fails validation makes every reader fall back to the DEFAULT prices.
 */
export function appendSheetCost(current: ShopSettings, paperIqd: number, plasticIqd: number, now: Date): AppendCostResult {
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_IQD;
  if (!ok(paperIqd) || !ok(plasticIqd)) return { ok: false, error: 'invalid' };
  const entries = current.accounting?.sheetCosts ?? [];
  const inForce = currentCost(entries);
  if (inForce && inForce.paperIqd === paperIqd && inForce.plasticIqd === plasticIqd) return { ok: false, error: 'unchanged' };
  if (entries.length >= MAX_SHEET_COST_ENTRIES) return { ok: false, error: 'tooMany' };
  const candidate: ShopSettings = {
    ...current,
    accounting: { sheetCosts: [...entries, { from: now.toISOString(), paperIqd, plasticIqd }] },
  };
  const parsed = shopSettingsSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: 'failed' };
  return { ok: true, settings: parsed.data };
}
