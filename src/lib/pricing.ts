/**
 * Pricing — OWNED BY AGENT A. Pure.
 *
 * Rules (docs/PLAN.md §6):
 *  - offerPriceIqd = offer.priceIqd when settings.pricesPublished && offer.priceIqd !== null, else null.
 *  - deliveryFeeIqd = settings.deliveryFeeIqd (added to EVERY order).
 *  - totalIqd = offerPriceIqd + deliveryFeeIqd, or null when offerPriceIqd is null.
 *  - totalStickers = offer.sheets × countPerSheet.
 *  - perStickerIqd = round(totalIqd / totalStickers) or null.
 *  The SERVER recomputes this from offerId; the client never sends a price.
 */
import type { Offer, PriceBreakdown, ShopSettings } from '@/lib/types';

export function priceFor(offer: Offer, countPerSheet: number, settings: ShopSettings): PriceBreakdown {
  const offerPriceIqd = settings.pricesPublished && offer.priceIqd !== null ? offer.priceIqd : null;
  const deliveryFeeIqd = settings.deliveryFeeIqd;
  const totalIqd = offerPriceIqd === null ? null : offerPriceIqd + deliveryFeeIqd;
  const totalStickers = offer.sheets * countPerSheet;
  const perStickerIqd = totalIqd === null || totalStickers <= 0 ? null : Math.round(totalIqd / totalStickers);
  return { offerPriceIqd, deliveryFeeIqd, totalIqd, totalStickers, perStickerIqd };
}

/** Find an enabled offer by id, or null. */
export function findOffer(offerId: string, settings: ShopSettings): Offer | null {
  return settings.offers.find((o) => o.id === offerId && o.enabled) ?? null;
}

/** "25,000" — Western digits, Arabic-Iraq grouping. Append the currency in the UI copy. */
export function formatIqd(amount: number): string {
  return new Intl.NumberFormat('ar-IQ-u-nu-latn', { maximumFractionDigits: 0 }).format(amount);
}
