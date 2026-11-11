/**
 * Pricing — pure, shared by client (preview) and server (authoritative).
 *
 * Rules (owner, 2026-11-10, sticker count and rounding 2026-11-11):
 *  - Customer picks a material (paper / plastic) and types a STICKER count.
 *    sheets = ceil(stickers / countPerSheet): the customer receives the whole last sheet.
 *    Allowed: pricing.minSheets × countPerSheet ≤ stickers ≤ pricing.maxSheets × countPerSheet.
 *    (Old clients send a sheet count; that path still works, see validateQuantity.)
 *  - unitBase = pricing.materials[material].pricePerSheetIqd.
 *  - discountPercent = percent of the highest tier with minSheets ≤ sheets (0 if none).
 *  - unitPrice = round(unitBase × (100 − discount) / 100).
 *  - raw = unitPrice × sheets + deliveryFeeIqd (flat, every governorate).
 *  - total = max(deliveryFeeIqd, raw rounded to the nearest PRICE_ROUND_IQD, half up);
 *    subtotal = total − delivery (the sheets' share after rounding, so the rows add up);
 *    rounding = total − raw (may be negative or 0).
 *  - When !settings.pricesPublished every money field except delivery is null.
 *  The SERVER recomputes this from (material, stickers | sheets); the client never sends a price.
 */
import { MATERIALS } from '@/lib/types';
import type { DiscountTier, Material, PriceBreakdown, PricingSettings, ShopSettings } from '@/lib/types';

/** The final price is rounded to this step, in dinar (owner, 2026-11-11). Not an admin setting. */
export const PRICE_ROUND_IQD = 1_000;

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

/** `n` rounded to the nearest multiple of `step` (halves round up). A step ≤ 0 rounds to the unit. */
export function roundToStep(n: number, step: number): number {
  if (!(step > 0)) return Math.round(n);
  return Math.round(n / step) * step;
}

/** True when a layout gives a usable stickers-per-sheet count (guards every division by it). */
function usableCount(countPerSheet: number): boolean {
  return Number.isInteger(countPerSheet) && countPerSheet > 0;
}

/** Sheets needed for `stickers`: ceil(stickers / countPerSheet). 0 when countPerSheet is not a positive integer. */
export function sheetsForStickers(stickers: number, countPerSheet: number): number {
  if (!usableCount(countPerSheet)) return 0;
  return Math.ceil(stickers / countPerSheet);
}

/** Smallest sticker order for this layout: the stickers of pricing.minSheets sheets (0 without a usable layout). */
export function minStickers(countPerSheet: number, pricing: Pick<PricingSettings, 'minSheets'>): number {
  return usableCount(countPerSheet) ? pricing.minSheets * countPerSheet : 0;
}

/**
 * Largest sticker count one order request may carry (the API's zod cap). maxStickers() never goes
 * above it, so the builder and the server agree even for tiny stickers or a high maxSheets.
 */
export const MAX_STICKERS_REQUEST = 10_000_000;

/**
 * Largest sticker order for this layout: the stickers of pricing.maxSheets sheets, but never more
 * whole sheets than fit under MAX_STICKERS_REQUEST (0 without a usable layout). Always a whole number of sheets.
 */
export function maxStickers(countPerSheet: number, pricing: Pick<PricingSettings, 'maxSheets'>): number {
  if (!usableCount(countPerSheet)) return 0;
  return Math.min(pricing.maxSheets, Math.floor(MAX_STICKERS_REQUEST / countPerSheet)) * countPerSheet;
}

/**
 * null when (material, stickers) is orderable for a layout with `countPerSheet` stickers per sheet.
 * Same checks and order as validateQuantity(), in stickers. A countPerSheet that is not a
 * positive integer (no layout) is 'below_min': nothing can be ordered.
 */
export function validateStickers(
  material: Material,
  stickers: number,
  countPerSheet: number,
  pricing: PricingSettings,
): QuantityError | null {
  if (!pricing.materials[material]?.enabled) return 'material_disabled';
  if (!Number.isInteger(stickers)) return 'not_integer';
  if (!usableCount(countPerSheet)) return 'below_min';
  if (stickers < minStickers(countPerSheet, pricing)) return 'below_min';
  if (stickers > maxStickers(countPerSheet, pricing)) return 'above_max';
  return null;
}

/** Enabled materials in display order. */
export function enabledMaterials(pricing: PricingSettings): Material[] {
  return MATERIALS.filter((m) => pricing.materials[m].enabled);
}

/** Price of `sheets` sheets (rounded total, see the rules at the top). Signature kept for the sheet-count path. */
export function priceFor(material: Material, sheets: number, countPerSheet: number, settings: ShopSettings): PriceBreakdown {
  const { pricing, pricesPublished, deliveryFeeIqd } = settings;
  const discountPercent = discountFor(sheets, pricing.tiers);
  const base = pricesPublished ? pricing.materials[material].pricePerSheetIqd : null;
  const unitPriceIqd = base === null ? null : unitPriceFor(base, discountPercent);
  const rawIqd = unitPriceIqd === null ? null : unitPriceIqd * sheets + deliveryFeeIqd;
  const totalIqd = rawIqd === null ? null : Math.max(deliveryFeeIqd, roundToStep(rawIqd, PRICE_ROUND_IQD));
  const subtotalIqd = totalIqd === null ? null : totalIqd - deliveryFeeIqd;
  const roundingIqd = totalIqd === null || rawIqd === null ? null : totalIqd - rawIqd;
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
    roundingIqd,
  };
}

/**
 * Price of a STICKER order: sheets = ceil(stickers / countPerSheet), priced by priceFor(), with
 * the typed count kept as `requestedStickers`. Validate first with validateStickers().
 */
export function priceForStickers(material: Material, stickers: number, countPerSheet: number, settings: ShopSettings): PriceBreakdown {
  return { ...priceFor(material, sheetsForStickers(stickers, countPerSheet), countPerSheet, settings), requestedStickers: stickers };
}

/** "25,000" — Western digits, Arabic-Iraq grouping. Append the currency in the UI copy. */
export function formatIqd(amount: number): string {
  return IQD_FORMAT.format(amount);
}
