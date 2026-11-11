import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeExamples, discountRows, illustrationLayout, priceExample } from '@/app/how-it-works/examples';
import { priceFor } from '@/lib/pricing';
import type { PricingSettings, ShopSettings } from '@/lib/types';

describe('how-it-works examples', () => {
  const rows = computeExamples(DEFAULT_SETTINGS.layout);
  const get = (k: string) => rows.find((r) => r.key === k)?.count;

  it('3 cm circle gives 54 per sheet with default settings', () => {
    expect(get('circle3')).toBe(54);
  });
  it('every example fits on the sheet', () => {
    for (const r of rows) expect(r.count).toBeGreaterThan(0);
  });
  it('sharp rectangles pack at least as many as rounded', () => {
    expect(get('sharp5')!).toBeGreaterThanOrEqual(get('rounded5')!);
  });
  it('illustration layout matches the 3 cm circle count', () => {
    const l = illustrationLayout(DEFAULT_SETTINGS.layout);
    expect(l?.countPerSheet).toBe(54);
    expect(l?.placements).toHaveLength(54);
  });
});

const pricingWith = (p: Partial<PricingSettings>): PricingSettings => ({ ...DEFAULT_SETTINGS.pricing, ...p });
const settingsWith = (p: Partial<PricingSettings>, rest: Partial<ShopSettings> = {}): ShopSettings => ({
  ...DEFAULT_SETTINGS,
  ...rest,
  pricing: pricingWith(p),
});

describe('how-it-works discount table rows', () => {
  it('default settings: 10-19 no discount, 20-49 10%, 50-99 15%, 100+ 20%', () => {
    expect(discountRows(DEFAULT_SETTINGS.pricing)).toEqual([
      { from: 10, to: 19, percent: 0 },
      { from: 20, to: 49, percent: 10 },
      { from: 50, to: 99, percent: 15 },
      { from: 100, to: null, percent: 20 },
    ]);
  });
  it('no tiers: a single open-ended row without discount', () => {
    expect(discountRows(pricingWith({ tiers: [] }))).toEqual([{ from: 10, to: null, percent: 0 }]);
  });
  it('a single tier above minSheets: the no-discount row, then the open-ended tier row', () => {
    expect(discountRows(pricingWith({ tiers: [{ minSheets: 40, percent: 7 }] }))).toEqual([
      { from: 10, to: 39, percent: 0 },
      { from: 40, to: null, percent: 7 },
    ]);
  });
  it('a tier equal to minSheets replaces the no-discount row', () => {
    const tiers = [
      { minSheets: 10, percent: 5 },
      { minSheets: 50, percent: 15 },
    ];
    expect(discountRows(pricingWith({ tiers }))).toEqual([
      { from: 10, to: 49, percent: 5 },
      { from: 50, to: null, percent: 15 },
    ]);
  });
  it('tiers below minSheets collapse into the row that starts at minSheets', () => {
    const tiers = [
      { minSheets: 10, percent: 5 },
      { minSheets: 20, percent: 10 },
      { minSheets: 50, percent: 15 },
    ];
    expect(discountRows(pricingWith({ minSheets: 30, tiers }))).toEqual([
      { from: 30, to: 49, percent: 10 },
      { from: 50, to: null, percent: 15 },
    ]);
  });
  it('every tier at or below minSheets: one open-ended row with the highest tier', () => {
    expect(discountRows(pricingWith({ minSheets: 200 }))).toEqual([{ from: 200, to: null, percent: 20 }]);
    expect(discountRows(pricingWith({ minSheets: 100 }))).toEqual([{ from: 100, to: null, percent: 20 }]);
  });
  it('sorts the tiers by minSheets without changing the settings', () => {
    const tiers = [
      { minSheets: 100, percent: 20 },
      { minSheets: 20, percent: 10 },
      { minSheets: 50, percent: 15 },
    ];
    const before = JSON.stringify(tiers);
    expect(discountRows(pricingWith({ tiers }))).toEqual(discountRows(DEFAULT_SETTINGS.pricing));
    expect(JSON.stringify(tiers)).toBe(before);
  });
});

describe('how-it-works price example', () => {
  const paperOnly = {
    paper: { enabled: true, pricePerSheetIqd: 1_000 },
    plastic: { enabled: false, pricePerSheetIqd: 2_000 },
  };

  it('default settings: 50 plastic sheets at the discounted subtotal', () => {
    const subtotal = priceFor('plastic', 50, 1, DEFAULT_SETTINGS).subtotalIqd;
    expect(subtotal).not.toBeNull();
    expect(priceExample(DEFAULT_SETTINGS)).toEqual({ material: 'plastic', sheets: 50, price: subtotal });
  });
  it('the price is the subtotal: discounted sheet price × sheets, delivery not included', () => {
    const settings = settingsWith({ materials: paperOnly, tiers: [{ minSheets: 50, percent: 10 }] }, { deliveryFeeIqd: 5_000 });
    expect(priceExample(settings)).toEqual({ material: 'paper', sheets: 50, price: 45_000 });
  });
  it('pricesPublished=false gives null', () => {
    expect(priceExample({ ...DEFAULT_SETTINGS, pricesPublished: false })).toBeNull();
  });
  it('plastic is preferred when it is enabled', () => {
    const both = {
      paper: { enabled: true, pricePerSheetIqd: 1_000 },
      plastic: { enabled: true, pricePerSheetIqd: 2_000 },
    };
    expect(priceExample(settingsWith({ materials: both, tiers: [] }))).toEqual({ material: 'plastic', sheets: 50, price: 100_000 });
  });
  it('otherwise the first enabled material is used', () => {
    expect(priceExample(settingsWith({ materials: paperOnly, tiers: [] }))).toEqual({ material: 'paper', sheets: 50, price: 50_000 });
  });
  it('no enabled material gives null', () => {
    const none = {
      paper: { enabled: false, pricePerSheetIqd: 1_000 },
      plastic: { enabled: false, pricePerSheetIqd: 2_000 },
    };
    expect(priceExample(settingsWith({ materials: none }))).toBeNull();
  });
  it('sheets are clamped into minSheets..maxSheets', () => {
    expect(priceExample(settingsWith({ minSheets: 80 }))?.sheets).toBe(80);
    expect(priceExample(settingsWith({ minSheets: 1, maxSheets: 30 }))?.sheets).toBe(30);
    expect(priceExample(settingsWith({ minSheets: 50, maxSheets: 50 }))?.sheets).toBe(50);
    expect(priceExample(settingsWith({ minSheets: 1, maxSheets: 5_000 }))?.sheets).toBe(50);
  });
});
