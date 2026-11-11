import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import {
  activeTier,
  discountFor,
  enabledMaterials,
  formatIqd,
  MAX_STICKERS_REQUEST,
  maxStickers,
  minStickers,
  PRICE_ROUND_IQD,
  priceFor,
  priceForStickers,
  roundToStep,
  sheetsForStickers,
  unitPriceFor,
  validateQuantity,
  validateStickers,
} from './pricing';
import { orderRequestSchema } from '@/lib/order-schema';
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
  it('plastic × 50 sheets: 15% off, delivery added, total rounded to 1,000', () => {
    // raw = 1,275 × 50 + 5,000 = 68,750 → 69,000; the sheets row absorbs the rounding.
    expect(priceFor('plastic', 50, 54, settings())).toEqual({
      material: 'plastic',
      sheets: 50,
      unitBaseIqd: 1500,
      discountPercent: 15,
      unitPriceIqd: 1275,
      subtotalIqd: 64_000,
      deliveryFeeIqd: 5_000,
      totalIqd: 69_000,
      totalStickers: 2700,
      perStickerIqd: 26,
      roundingIqd: 250,
    });
  });
  it('paper × 10 sheets: no discount', () => {
    const r = priceFor('paper', 10, 20, settings());
    expect(r.unitPriceIqd).toBe(800);
    expect(r.subtotalIqd).toBe(8_000);
    expect(r.totalIqd).toBe(13_000);
    expect(r.roundingIqd).toBe(0);
  });
  it('unpublished hides money but keeps delivery and counts', () => {
    const r = priceFor('paper', 20, 10, settings({ pricesPublished: false }));
    expect(r.unitBaseIqd).toBeNull();
    expect(r.unitPriceIqd).toBeNull();
    expect(r.subtotalIqd).toBeNull();
    expect(r.totalIqd).toBeNull();
    expect(r.perStickerIqd).toBeNull();
    expect(r.roundingIqd).toBeNull();
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

describe('roundToStep / final price rounding', () => {
  it('step is 1,000 dinar', () => expect(PRICE_ROUND_IQD).toBe(1_000));
  it.each([
    [26_500, 27_000],
    [26_499, 26_000],
    [20_300, 20_000],
    [19_400, 19_000],
    [68_750, 69_000],
    [5_000, 5_000],
    [0, 0],
  ])('%i → %i', (n, r) => expect(roundToStep(n, PRICE_ROUND_IQD)).toBe(r));
  it('a step ≤ 0 rounds to the unit', () => {
    expect(roundToStep(12.5, 0)).toBe(13);
    expect(roundToStep(12.4, -5)).toBe(12);
  });

  const flat = (pricePerSheetIqd: number, deliveryFeeIqd: number): ShopSettings =>
    settings({
      deliveryFeeIqd,
      pricing: { ...P, tiers: [], materials: { ...P.materials, paper: { enabled: true, pricePerSheetIqd } } },
    });
  it('half rounds up: 21,500 + 5,000 = 26,500 → 27,000', () => {
    const r = priceFor('paper', 10, 54, flat(2_150, 5_000));
    expect(r.totalIqd).toBe(27_000);
    expect(r.subtotalIqd).toBe(22_000);
    expect(r.roundingIqd).toBe(500);
  });
  it('15,300 + 5,000 = 20,300 → 20,000 (rounding may be negative)', () => {
    const r = priceFor('paper', 10, 54, flat(1_530, 5_000));
    expect(r.totalIqd).toBe(20_000);
    expect(r.subtotalIqd).toBe(15_000);
    expect(r.roundingIqd).toBe(-300);
    expect(r.unitPriceIqd).toBe(1_530);
  });
  it('rows add up: subtotal + delivery = total, unit × sheets + delivery + rounding = total', () => {
    for (const sheets of [10, 11, 19, 20, 37, 50, 99, 100, 777]) {
      for (const material of ['paper', 'plastic'] as const) {
        const r = priceFor(material, sheets, 54, settings());
        expect(r.subtotalIqd! + r.deliveryFeeIqd).toBe(r.totalIqd);
        expect(r.unitPriceIqd! * sheets + r.deliveryFeeIqd + r.roundingIqd!).toBe(r.totalIqd);
        expect(r.totalIqd! % PRICE_ROUND_IQD).toBe(0);
      }
    }
  });
  it('the total is never below the delivery fee', () => {
    // 1 × 300 + 5,000 = 5,300 → 5,000; 1 × 100 + 4,200 (odd fee) = 4,300 → 4,000 → kept at 4,200.
    expect(priceFor('paper', 1, 1, flat(300, 5_000)).totalIqd).toBe(5_000);
    const odd = priceFor('paper', 1, 1, flat(100, 4_200));
    expect(odd.totalIqd).toBe(4_200);
    expect(odd.subtotalIqd).toBe(0);
    expect(odd.roundingIqd).toBe(-100);
  });
  it('perStickerIqd uses the rounded total', () => {
    // paper 20 sheets: 720 × 20 + 5,000 = 19,400 → 19,000 / 1,080 stickers = 17.6 → 18
    const r = priceFor('paper', 20, 54, settings());
    expect(r.totalIqd).toBe(19_000);
    expect(r.perStickerIqd).toBe(18);
  });
});

describe('sticker count → sheets', () => {
  it.each([
    [539, 54, 10],
    [540, 54, 10],
    [541, 54, 11],
    [594, 54, 11],
    [595, 54, 12],
    [600, 54, 12],
    [1, 54, 1],
    [54, 54, 1],
    [55, 54, 2],
    [7, 1, 7],
  ])('%i stickers at %i per sheet → %i sheets', (stickers, cps, sheets) => expect(sheetsForStickers(stickers, cps)).toBe(sheets));
  it('no division by zero: a count per sheet ≤ 0 or fractional gives 0 sheets', () => {
    expect(sheetsForStickers(600, 0)).toBe(0);
    expect(sheetsForStickers(600, -54)).toBe(0);
    expect(sheetsForStickers(600, 1.5)).toBe(0);
    expect(sheetsForStickers(600, Number.NaN)).toBe(0);
  });
  it('min / max stickers = min / max sheets × count per sheet', () => {
    expect(minStickers(54, P)).toBe(540);
    expect(maxStickers(54, P)).toBe(P.maxSheets * 54);
    expect(minStickers(6, P)).toBe(60);
    expect(minStickers(0, P)).toBe(0);
    expect(maxStickers(0, P)).toBe(0);
  });
  it('max stickers never exceeds the API request cap and stays a whole number of sheets', () => {
    // 0.5 cm sharp square: 2,184 per sheet × 5,000 sheets = 10,920,000 > cap
    const max = maxStickers(2184, P);
    expect(max).toBe(Math.floor(MAX_STICKERS_REQUEST / 2184) * 2184);
    expect(max).toBeLessThanOrEqual(MAX_STICKERS_REQUEST);
    expect(validateStickers('paper', 10_500_000, 2184, P)).toBe('above_max');
    expect(validateStickers('paper', max, 2184, P)).toBeNull();
    expect(maxStickers(2184, { ...P, maxSheets: 100_000 })).toBe(max);
  });
  it('the zod cap on stickers is the same constant', () => {
    const base = {
      orderId: 'a'.repeat(12), uploadId: 'b'.repeat(12),
      spec: { shape: 'rect', corners: 'sharp', widthUm: 5000, heightUm: 5000 }, material: 'paper',
      customer: { phone: '07701234567', governorate: 'بغداد', district: '', landmark: 'x' },
    };
    const issues = (stickers: number) =>
      (orderRequestSchema.safeParse({ ...base, stickers }).error?.issues ?? []).filter((i) => i.path[0] === 'stickers');
    expect(issues(MAX_STICKERS_REQUEST)).toEqual([]);
    expect(issues(MAX_STICKERS_REQUEST + 1)).not.toEqual([]);
  });
});

describe('validateStickers', () => {
  const max = P.maxSheets * 54;
  it.each([
    [540, null],
    [541, null],
    [539, 'below_min'],
    [0, 'below_min'],
    [-540, 'below_min'],
    [max, null],
    [max + 1, 'above_max'],
    [600.5, 'not_integer'],
    [Number.NaN, 'not_integer'],
    [Number.POSITIVE_INFINITY, 'not_integer'],
  ])('%s stickers at 54 per sheet → %s', (stickers, err) => expect(validateStickers('paper', stickers, 54, P)).toBe(err));
  it('the maximum is a whole number of sheets: max stickers → exactly maxSheets', () => {
    expect(sheetsForStickers(max, 54)).toBe(P.maxSheets);
  });
  it('a disabled material wins over every other problem', () => {
    const pricing = { ...P, materials: { ...P.materials, plastic: { ...P.materials.plastic, enabled: false } } };
    expect(validateStickers('plastic', 600, 54, pricing)).toBe('material_disabled');
    expect(validateStickers('plastic', 1.5, 0, pricing)).toBe('material_disabled');
  });
  it('a count per sheet ≤ 0 (no layout) is an invalid quantity, never a division by zero', () => {
    expect(validateStickers('paper', 600, 0, P)).toBe('below_min');
    expect(validateStickers('paper', 600, -1, P)).toBe('below_min');
  });
  it('inverted settings (min > max) report below_min first, like validateQuantity', () => {
    const pricing = { ...P, minSheets: 50, maxSheets: 40 };
    expect(validateStickers('paper', 45 * 54, 54, pricing)).toBe('below_min');
    expect(validateQuantity('paper', 45, pricing)).toBe('below_min');
  });
});

describe('priceForStickers', () => {
  it('600 typed at 54 per sheet → 12 sheets, 648 stickers received, typed count kept', () => {
    const r = priceForStickers('paper', 600, 54, settings());
    expect(r).toEqual({ ...priceFor('paper', 12, 54, settings()), requestedStickers: 600 });
    expect(r.sheets).toBe(12);
    expect(r.totalStickers).toBe(648);
    // 800 × 12 + 5,000 = 14,600 → 15,000
    expect(r.totalIqd).toBe(15_000);
    expect(r.subtotalIqd).toBe(10_000);
    expect(r.roundingIqd).toBe(400);
    expect(r.perStickerIqd).toBe(23);
  });
  it('discount tiers stay in sheets, on the rounded-up count: 1,027 stickers → 20 sheets → 10%, 1,026 → 19 sheets → 0%', () => {
    expect(priceForStickers('paper', 1_080, 54, settings()).discountPercent).toBe(10);
    expect(priceForStickers('paper', 1_027, 54, settings()).sheets).toBe(20);
    expect(priceForStickers('paper', 1_027, 54, settings()).discountPercent).toBe(10);
    expect(priceForStickers('paper', 1_026, 54, settings()).discountPercent).toBe(0);
  });
  it('unpublished prices: every money field null, counts kept', () => {
    const r = priceForStickers('plastic', 541, 54, settings({ pricesPublished: false }));
    expect([r.unitBaseIqd, r.unitPriceIqd, r.subtotalIqd, r.totalIqd, r.perStickerIqd, r.roundingIqd]).toEqual([null, null, null, null, null, null]);
    expect(r.sheets).toBe(11);
    expect(r.totalStickers).toBe(594);
    expect(r.requestedStickers).toBe(541);
  });
  it('count per sheet 0 does not throw or divide by zero', () => {
    const r = priceForStickers('paper', 600, 0, settings());
    expect(r.sheets).toBe(0);
    expect(r.totalStickers).toBe(0);
    expect(r.perStickerIqd).toBeNull();
  });
  it('a sheet-count price has no requestedStickers key', () => {
    expect('requestedStickers' in priceFor('paper', 12, 54, settings())).toBe(false);
  });
});

describe('formatIqd', () => {
  it('Western digits with grouping', () => expect(formatIqd(68750)).toBe('68,750'));
});
