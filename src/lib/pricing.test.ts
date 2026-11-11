import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { activeTier, discountFor, enabledMaterials, formatIqd, priceFor, unitPriceFor, validateQuantity } from './pricing';
import type { DiscountTier, ShopSettings } from '@/lib/types';

const settings = (over: Partial<ShopSettings> = {}): ShopSettings => ({ ...DEFAULT_SETTINGS, ...over });
const P = DEFAULT_SETTINGS.pricing;

describe('defaults (owner prices)', () => {
  it('paper 800, plastic 1500, min 10, delivery 5000, published', () => {
    expect(P.materials.paper.pricePerSheetIqd).toBe(800);
    expect(P.materials.plastic.pricePerSheetIqd).toBe(1500);
    expect(P.minSheets).toBe(10);
    expect(DEFAULT_SETTINGS.deliveryFeeIqd).toBe(5_000);
    expect(DEFAULT_SETTINGS.pricesPublished).toBe(true);
  });
});

describe('discountFor', () => {
  it.each([
    [10, 0],
    [19, 0],
    [20, 10],
    [49, 10],
    [50, 15],
    [99, 15],
    [100, 20],
    [5000, 20],
  ])('%i sheets → %i%%', (sheets, pct) => expect(discountFor(sheets, P.tiers)).toBe(pct));
  it('order of tiers does not matter', () => {
    expect(discountFor(60, [{ minSheets: 100, percent: 20 }, { minSheets: 20, percent: 10 }, { minSheets: 50, percent: 15 }])).toBe(15);
  });
  it('no tiers → 0', () => expect(discountFor(500, [])).toBe(0));
});

describe('discountFor and activeTier pick the same tier (valid tiers)', () => {
  const lists: [string, DiscountTier[]][] = [
    ['the default tiers', P.tiers],
    ['an unsorted list', [{ minSheets: 100, percent: 20 }, { minSheets: 20, percent: 10 }, { minSheets: 50, percent: 15 }]],
    ['an empty list', []],
  ];
  it.each(lists)('%s, sheets 0..150', (_name, tiers) => {
    for (let n = 0; n <= 150; n++) {
      expect(discountFor(n, tiers), `sheets=${n}`).toBe(activeTier(n, tiers)?.percent ?? 0);
    }
  });
});

describe('unitPriceFor', () => {
  it('rounds to the dinar', () => {
    expect(unitPriceFor(1500, 15)).toBe(1275);
    expect(unitPriceFor(800, 20)).toBe(640);
    expect(unitPriceFor(999, 15)).toBe(849);
  });
});

describe('priceFor', () => {
  it('plastic × 50 sheets: 15% off, delivery added', () => {
    expect(priceFor('plastic', 50, 54, settings())).toEqual({
      material: 'plastic',
      sheets: 50,
      unitBaseIqd: 1500,
      discountPercent: 15,
      unitPriceIqd: 1275,
      subtotalIqd: 63_750,
      deliveryFeeIqd: 5_000,
      totalIqd: 68_750,
      totalStickers: 2700,
      perStickerIqd: 25,
    });
  });
  it('paper × 10 sheets: no discount', () => {
    const r = priceFor('paper', 10, 20, settings());
    expect(r.unitPriceIqd).toBe(800);
    expect(r.subtotalIqd).toBe(8_000);
    expect(r.totalIqd).toBe(13_000);
  });
  it('unpublished hides money but keeps delivery and counts', () => {
    const r = priceFor('paper', 20, 10, settings({ pricesPublished: false }));
    expect(r.unitBaseIqd).toBeNull();
    expect(r.unitPriceIqd).toBeNull();
    expect(r.subtotalIqd).toBeNull();
    expect(r.totalIqd).toBeNull();
    expect(r.perStickerIqd).toBeNull();
    expect(r.discountPercent).toBe(10);
    expect(r.deliveryFeeIqd).toBe(5_000);
    expect(r.totalStickers).toBe(200);
  });
  it('avoids divide by zero', () => {
    expect(priceFor('paper', 10, 0, settings()).perStickerIqd).toBeNull();
  });
});

describe('validateQuantity', () => {
  it('accepts the minimum', () => expect(validateQuantity('paper', 10, P)).toBeNull());
  it('rejects below min, above max, fractions', () => {
    expect(validateQuantity('paper', 9, P)).toBe('below_min');
    expect(validateQuantity('paper', P.maxSheets + 1, P)).toBe('above_max');
    expect(validateQuantity('paper', 10.5, P)).toBe('not_integer');
  });
  it('rejects a disabled material', () => {
    const pricing = { ...P, materials: { ...P.materials, plastic: { ...P.materials.plastic, enabled: false } } };
    expect(validateQuantity('plastic', 20, pricing)).toBe('material_disabled');
    expect(enabledMaterials(pricing)).toEqual(['paper']);
  });
});

describe('formatIqd', () => {
  it('Western digits with grouping', () => expect(formatIqd(68750)).toBe('68,750'));
});
