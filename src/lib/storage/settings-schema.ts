import { z } from 'zod';
import { DEFAULT_SETTINGS } from '../../config/defaults';
import type { ShopSettings } from '../types';
import { MAX_DISCOUNT_TIERS, MAX_QUICK_PICKS, MAX_TIER_PERCENT } from './settings-limits';

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const materialPriceSchema = z.object({
  enabled: z.boolean(),
  pricePerSheetIqd: int(0, 100_000_000),
});

export const pricingSchema = z
  .object({
    materials: z
      .object({ paper: materialPriceSchema, plastic: materialPriceSchema })
      .refine((m) => m.paper.enabled || m.plastic.enabled, 'at least one material must be enabled'),
    minSheets: int(1, 100_000),
    maxSheets: int(1, 100_000),
    tiers: z
      .array(z.object({ minSheets: int(1, 100_000), percent: int(0, MAX_TIER_PERCENT) }))
      .max(MAX_DISCOUNT_TIERS)
      .refine((t) => new Set(t.map((x) => x.minSheets)).size === t.length, 'duplicate tier')
      .transform((t) => [...t].sort((a, b) => a.minSheets - b.minSheets)),
    quickPicks: z.array(int(1, 100_000)).max(MAX_QUICK_PICKS),
  })
  .refine((p) => p.minSheets <= p.maxSheets, 'minSheets must be ≤ maxSheets');

export const shopSettingsSchema = z.object({
  shopName: z.string().min(1).max(80),
  tagline: z.string().max(160),
  whatsapp: z.string().regex(/^\d{0,15}$/),
  phone: z.string().max(40),
  hours: z.string().max(160),
  area: z.string().max(80),
  telegramChatId: z.string().max(64),
  pricing: pricingSchema,
  deliveryFeeIqd: int(0, 1_000_000_000),
  pricesPublished: z.boolean(),
  layout: z.object({
    marginUm: int(0, 50_000),
    circleGapXUm: int(0, 50_000),
    circleGapYUm: int(0, 50_000),
    rectRoundedGapUm: int(0, 50_000),
    rectSharpGapUm: int(0, 50_000),
    customGapUm: int(0, 50_000),
    roundedRadiusUm: int(0, 100_000),
    allowRotate: z.boolean(),
    minSideUm: int(1_000, 100_000),
  }),
  quality: z.object({
    warnDpi: int(1, 2400),
    blockDpi: int(1, 2400),
    targetDpi: int(72, 1200),
  }),
  maxUploadBytes: int(1024, 100 * 1024 * 1024),
  retentionDays: int(1, 3650),
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge; arrays and scalars from `over` replace the base. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over))
    return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v;
  }
  return out as T;
}

/**
 * What a storage backend holds for the settings (settings.json, the Supabase row) → validated
 * ShopSettings: the stored value is deep-merged over a fresh copy of DEFAULT_SETTINGS and
 * checked with the schema. On failure `issuePaths` names the offending fields ("a.b, c") for
 * the caller's log line; the caller decides what to fall back to.
 */
export function parseStoredSettings(
  raw: unknown,
): { ok: true; settings: ShopSettings } | { ok: false; issuePaths: string } {
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
  const parsed = shopSettingsSchema.safeParse(merged);
  if (parsed.success) return { ok: true, settings: parsed.data };
  return { ok: false, issuePaths: parsed.error.issues.map((i) => i.path.join('.')).join(', ') };
}
