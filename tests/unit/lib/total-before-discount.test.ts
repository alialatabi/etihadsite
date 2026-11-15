/**
 * totalBeforeDiscountIqd(): the final total the same order would have without the volume discount,
 * and the two-row (before / after) total in SummaryCard. No JSX here, so elements use createElement.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SummaryCard } from '@/components/builder/SummaryCard';
import { buildSummary } from '@/components/builder/logic';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { builder } from '@/content/ar';
import { PRICE_ROUND_IQD, priceFor, totalBeforeDiscountIqd } from '@/lib/pricing';
import type { ShopSettings, StickerSpec } from '@/lib/types';

const noTiers = (over: Partial<ShopSettings> = {}): ShopSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  pricing: { ...DEFAULT_SETTINGS.pricing, tiers: [] },
});

describe('totalBeforeDiscountIqd', () => {
  it('is null without a discount', () => {
    const p = priceFor('paper', 10, 6, DEFAULT_SETTINGS);
    expect(p.discountPercent).toBe(0);
    expect(totalBeforeDiscountIqd(p)).toBeNull();
  });

  it('is null when prices are not published', () => {
    const p = priceFor('paper', 20, 6, { ...DEFAULT_SETTINGS, pricesPublished: false });
    expect(p.discountPercent).toBeGreaterThan(0);
    expect(p.unitBaseIqd).toBeNull();
    expect(totalBeforeDiscountIqd(p)).toBeNull();
  });

  it('equals the total priceFor gives with 0% tiers (same rounding)', () => {
    for (const material of ['paper', 'plastic'] as const) {
      for (const sheets of [10, 20, 33, 50, 77, 100, 250]) {
        const discounted = priceFor(material, sheets, 6, DEFAULT_SETTINGS);
        const flat = priceFor(material, sheets, 6, noTiers());
        expect(totalBeforeDiscountIqd(discounted)).toBe(discounted.discountPercent > 0 ? flat.totalIqd : null);
      }
    }
  });

  it('is a multiple of PRICE_ROUND_IQD and above the discounted total', () => {
    const p = priceFor('plastic', 50, 6, DEFAULT_SETTINGS);
    const before = totalBeforeDiscountIqd(p)!;
    expect(before % PRICE_ROUND_IQD).toBe(0);
    expect(before).toBeGreaterThan(p.totalIqd!);
  });

  it('is null when rounding makes before and after equal (tiny tier)', () => {
    const settings: ShopSettings = {
      ...DEFAULT_SETTINGS,
      pricing: {
        ...DEFAULT_SETTINGS.pricing,
        materials: {
          ...DEFAULT_SETTINGS.pricing.materials,
          paper: { ...DEFAULT_SETTINGS.pricing.materials.paper, pricePerSheetIqd: 1_000 },
        },
        tiers: [{ minSheets: 10, percent: 2 }],
      },
    };
    const p = priceFor('paper', 10, 6, settings);
    expect(p.discountPercent).toBe(2);
    const flat = priceFor('paper', 10, 6, { ...settings, pricing: { ...settings.pricing, tiers: [] } });
    expect(flat.totalIqd).toBe(p.totalIqd);
    expect(totalBeforeDiscountIqd(p)).toBeNull();
  });

  it('never goes below the delivery fee', () => {
    expect(totalBeforeDiscountIqd({ unitBaseIqd: 0, sheets: 20, deliveryFeeIqd: 300, discountPercent: 10 })).toBe(300);
  });
});

describe('SummaryCard total rows', () => {
  const spec: StickerSpec = { shape: 'circle', widthUm: 30_000, heightUm: 30_000 };
  const layout = { countPerSheet: 6 } as Parameters<typeof buildSummary>[1];
  const html = (sheets: number) =>
    renderToStaticMarkup(createElement(SummaryCard, { summary: buildSummary(spec, layout, priceFor('paper', sheets, 6, DEFAULT_SETTINGS)) }));

  it('shows before (struck through) and after rows when a discount applies', () => {
    const out = html(20);
    expect(out).toContain(builder.summary.totalBefore);
    expect(out).toContain(builder.summary.totalAfter);
    expect(out).toContain('line-through');
    expect(out).toContain('21,000');
  });

  it('keeps the single total row without a discount', () => {
    const out = html(10);
    expect(out).not.toContain(builder.summary.totalBefore);
    expect(out).not.toContain(builder.summary.totalAfter);
    expect(out).toContain(builder.summary.total);
  });
});
