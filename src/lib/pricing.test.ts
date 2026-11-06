import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { findOffer, formatIqd, priceFor } from './pricing';
import type { Offer, ShopSettings } from '@/lib/types';

const settings = (over: Partial<ShopSettings> = {}): ShopSettings => ({ ...DEFAULT_SETTINGS, deliveryFeeIqd: 5_000, ...over });
const offer = (over: Partial<Offer> = {}): Offer => ({ id: 'o1', sheets: 20, priceIqd: 40_000, enabled: true, ...over });

describe('priceFor', () => {
  it('published price: adds delivery, computes per-sticker', () => {
    expect(priceFor(offer(), 54, settings({ pricesPublished: true }))).toEqual({
      offerPriceIqd: 40_000,
      deliveryFeeIqd: 5_000,
      totalIqd: 45_000,
      totalStickers: 1080,
      perStickerIqd: 42,
    });
  });
  it('unpublished hides the price but keeps delivery', () => {
    expect(priceFor(offer(), 54, settings({ pricesPublished: false }))).toEqual({
      offerPriceIqd: null,
      deliveryFeeIqd: 5_000,
      totalIqd: null,
      totalStickers: 1080,
      perStickerIqd: null,
    });
  });
  it('null price yields null totals', () => {
    const r = priceFor(offer({ priceIqd: null }), 10, settings({ pricesPublished: true }));
    expect(r.offerPriceIqd).toBeNull();
    expect(r.totalIqd).toBeNull();
    expect(r.perStickerIqd).toBeNull();
    expect(r.totalStickers).toBe(200);
  });
  it('zero price is a real price', () => {
    const r = priceFor(offer({ priceIqd: 0 }), 10, settings({ pricesPublished: true }));
    expect(r.totalIqd).toBe(5_000);
  });
  it('uses the configured delivery fee and avoids divide by zero', () => {
    const r = priceFor(offer(), 0, settings({ pricesPublished: true, deliveryFeeIqd: 0 }));
    expect(r.totalIqd).toBe(40_000);
    expect(r.perStickerIqd).toBeNull();
  });
});

describe('findOffer', () => {
  const s = settings({ offers: [offer({ id: 'a' }), offer({ id: 'b', enabled: false })] });
  it('finds enabled offers', () => expect(findOffer('a', s)?.id).toBe('a'));
  it('ignores disabled offers', () => expect(findOffer('b', s)).toBeNull());
  it('returns null for unknown ids', () => expect(findOffer('zzz', s)).toBeNull());
});

describe('formatIqd', () => {
  it('groups with commas and Western digits', () => {
    expect(formatIqd(5000)).toBe('5,000');
    expect(formatIqd(1234567)).toBe('1,234,567');
    expect(formatIqd(0)).toBe('0');
  });
});
