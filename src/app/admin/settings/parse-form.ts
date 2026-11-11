/**
 * Admin settings form -> ShopSettings. Pure: no 'use server' and no next/* imports, so the
 * rules can be unit-tested without a request. saveSettingsAction (../actions.ts) is the only
 * caller; it does the session check, the read, the save and the redirect.
 */
import { admin } from '@/content/ar';
import { MAX_DISCOUNT_TIERS, MAX_QUICK_PICKS, MAX_TIER_PERCENT } from '@/lib/storage/settings-limits';
import { shopSettingsSchema } from '@/lib/storage/settings-schema';
import type { ShopSettings } from '@/lib/types';
import { mmToUm } from '@/lib/units';
import { LAYOUT_MM_FIELDS } from './fields';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const intOf = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === '' ? NaN : Number(v);
};
const formMmToUm = (f: FormData, k: string) => {
  const mm = intOf(f, k);
  return Number.isFinite(mm) ? mmToUm(mm) : NaN;
};

const s = admin.settings;

export type SettingsFormResult = { ok: true; settings: ShopSettings } | { ok: false; error: string };

/**
 * Builds the settings to save from the submitted form. Everything the form does not carry
 * (quality, maxUploadBytes, layout.minSideUm, ...) is kept from `current`. The business checks
 * run in a fixed order and the first failing one decides the message; the zod schema runs last.
 */
export function parseSettingsForm(formData: FormData, current: ShopSettings): SettingsFormResult {
  let tiersRaw: unknown;
  try {
    tiersRaw = JSON.parse(str(formData, 'tiers') || '[]');
  } catch {
    tiersRaw = null;
  }
  if (!Array.isArray(tiersRaw)) return { ok: false, error: s.invalid };
  const tiers = tiersRaw.map((r: Record<string, unknown>) => ({
    minSheets: r?.minSheets === '' ? NaN : Number(r?.minSheets),
    percent: r?.percent === '' ? NaN : Number(r?.percent),
  }));
  const quickPicks = str(formData, 'quickPicks')
    .split(/[,،\s]+/)
    .filter(Boolean)
    .map(Number);

  const pricing: ShopSettings['pricing'] = {
    materials: {
      paper: { enabled: formData.get('paperEnabled') === 'on', pricePerSheetIqd: intOf(formData, 'paperPrice') },
      plastic: { enabled: formData.get('plasticEnabled') === 'on', pricePerSheetIqd: intOf(formData, 'plasticPrice') },
    },
    minSheets: intOf(formData, 'minSheets'),
    maxSheets: intOf(formData, 'maxSheets'),
    tiers,
    quickPicks,
  };

  const m = pricing.materials;
  if (!m.paper.enabled && !m.plastic.enabled) return { ok: false, error: s.errors.noMaterial };
  if (pricing.minSheets > pricing.maxSheets) return { ok: false, error: s.errors.minMax };
  if (tiers.length > MAX_DISCOUNT_TIERS) return { ok: false, error: s.errors.tiersMax };
  if (new Set(tiers.map((x) => x.minSheets)).size !== tiers.length) return { ok: false, error: s.errors.duplicateTier };
  if (tiers.some((x) => Number.isInteger(x.percent) && (x.percent < 0 || x.percent > MAX_TIER_PERCENT))) return { ok: false, error: s.errors.tierPercent };
  if (quickPicks.length > MAX_QUICK_PICKS || quickPicks.some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, error: s.errors.quickPicks };
  if (quickPicks.some((n) => n < pricing.minSheets || n > pricing.maxSheets)) return { ok: false, error: s.errors.quickPicksRange };
  const nums = [m.paper.pricePerSheetIqd, m.plastic.pricePerSheetIqd, pricing.minSheets, pricing.maxSheets, ...tiers.flatMap((x) => [x.minSheets, x.percent])];
  if (nums.some((n) => !Number.isInteger(n))) return { ok: false, error: s.errors.number };

  const layout: ShopSettings['layout'] = { ...current.layout, allowRotate: formData.get('allowRotate') === 'on' };
  for (const { name, key } of LAYOUT_MM_FIELDS) layout[key] = formMmToUm(formData, name);

  const candidate: ShopSettings = {
    ...current,
    shopName: str(formData, 'shopName'),
    tagline: str(formData, 'tagline'),
    whatsapp: str(formData, 'whatsapp').replace(/\D/g, ''),
    phone: str(formData, 'phone'),
    hours: str(formData, 'hours'),
    area: str(formData, 'area'),
    telegramChatId: str(formData, 'telegramChatId'),
    pricing,
    deliveryFeeIqd: intOf(formData, 'deliveryFeeIqd'),
    pricesPublished: formData.get('pricesPublished') === 'on',
    retentionDays: intOf(formData, 'retentionDays'),
    layout,
  };

  const parsed = shopSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: admin.settings.invalid };
  }
  return { ok: true, settings: parsed.data };
}
