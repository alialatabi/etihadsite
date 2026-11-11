/**
 * Pricing — pure, shared by client (preview) and server (authoritative).
 *
 * Rules (owner, 2026-11-10):
 *  - Customer picks a material (paper / plastic) and a sheet count ≥ pricing.minSheets.
 *  - unitBase = pricing.materials[material].pricePerSheetIqd.
 *  - discountPercent = percent of the highest tier with minSheets ≤ sheets (0 if none).
 *  - unitPrice = round(unitBase × (100 − discount) / 100); subtotal = unitPrice × sheets.
 *  - total = subtotal + deliveryFeeIqd (flat, every governorate).
 *  - When !settings.pricesPublished every money field except delivery is null.
 *  The SERVER recomputes this from (material, sheets); the client never sends a price.
 */
import { MATERIALS } from '@/lib/types';
import type { DiscountTier, Material, PriceBreakdown, PricingSettings, ShopSettings } from '@/lib/types';

const IQD_FORMAT = new Intl.NumberFormat('ar-IQ-u-nu-latn', { maximumFractionDigits: 0 });

/** Discount % for this sheet count (highest qualifying tier). */
export function discountFor(sheets: number, tiers: readonly DiscountTier[]): number {
  let best = 0;
  let bestMin = -1;
  for (const t of tiers) {
    if (sheets >= t.minSheets && t.minSheets > bestMin) {
      best = t.percent;
      bestMin = t.minSheets;
    }
  }
  return best;
}

/** Tiers sorted ascending by minSheets (defensive copy). */
export function sortedTiers(tiers: readonly DiscountTier[]): DiscountTier[] {
  return [...tiers].sort((a, b) => a.minSheets - b.minSheets);
}

/** Tier currently reached (highest with minSheets <= sheets) or null. */
export function activeTier(sheets: number | null, tiers: readonly DiscountTier[]): DiscountTier | null {
  if (sheets === null) return null;
  let best: DiscountTier | null = null;
  for (const t of tiers) if (sheets >= t.minSheets && (!best || t.minSheets > best.minSheets)) best = t;
  return best;
}

export function unitPriceFor(base: number, discountPercent: number): number {
  return Math.round((base * (100 - discountPercent)) / 100);
}

export type QuantityError = 'material_disabled' | 'not_integer' | 'below_min' | 'above_max';

/** null when (material, sheets) is orderable under these settings. */
export function validateQuantity(material: Material, sheets: number, pricing: PricingSettings): QuantityError | null {
  if (!pricing.materials[material]?.enabled) return 'material_disabled';
  if (!Number.isInteger(sheets)) return 'not_integer';
  if (sheets < pricing.minSheets) return 'below_min';
  if (sheets > pricing.maxSheets) return 'above_max';
  return null;
}

/** Enabled materials in display order. */
export function enabledMaterials(pricing: PricingSettings): Material[] {
  return MATERIALS.filter((m) => pricing.materials[m].enabled);
}

export function priceFor(material: Material, sheets: number, countPerSheet: number, settings: ShopSettings): PriceBreakdown {
  const { pricing, pricesPublished, deliveryFeeIqd } = settings;
  const discountPercent = discountFor(sheets, pricing.tiers);
  const base = pricesPublished ? pricing.materials[material].pricePerSheetIqd : null;
  const unitPriceIqd = base === null ? null : unitPriceFor(base, discountPercent);
  const subtotalIqd = unitPriceIqd === null ? null : unitPriceIqd * sheets;
  const totalIqd = subtotalIqd === null ? null : subtotalIqd + deliveryFeeIqd;
  const totalStickers = sheets * countPerSheet;
  const perStickerIqd = totalIqd === null || totalStickers <= 0 ? null : Math.round(totalIqd / totalStickers);
  return {
    material,
    sheets,
    unitBaseIqd: base,
    discountPercent,
    unitPriceIqd,
    subtotalIqd,
    deliveryFeeIqd,
    totalIqd,
    totalStickers,
    perStickerIqd,
  };
}

/** "25,000" — Western digits, Arabic-Iraq grouping. Append the currency in the UI copy. */
export function formatIqd(amount: number): string {
  return IQD_FORMAT.format(amount);
}
