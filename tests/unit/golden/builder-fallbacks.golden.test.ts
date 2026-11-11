/**
 * GOLDEN — the FALLBACK branches of src/components/builder/safe.ts and degraded.ts.
 * Those branches run only when a sibling lib module throws, so every sibling is mocked to
 * throw here (the same technique tests/unit/builder/logic.test.ts uses). The happy paths
 * are pinned in builder-logic.golden.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

const { boom } = vi.hoisted(() => ({
  boom: (name: string) => () => {
    throw new Error(`GOLDEN_FORCED_FAILURE:${name}`);
  },
}));

vi.mock('@/lib/order-text', () => ({
  orderSummaryText: boom('orderSummaryText'),
  shapeLabel: boom('shapeLabel'),
  sizeLabel: boom('sizeLabel'),
}));
vi.mock('@/lib/parse/cm', async (orig) => ({
  ...(await orig<typeof import('@/lib/parse/cm')>()),
  parseCm: boom('parseCm'),
  formatCm: boom('formatCm'),
}));
vi.mock('@/lib/layout', () => ({
  computeLayout: boom('computeLayout'),
  layoutParamsFor: boom('layoutParamsFor'),
  deriveLockedSize: boom('deriveLockedSize'),
  maxWidthFor: boom('maxWidthFor'),
}));
vi.mock('@/lib/plural', () => ({ countLabel: boom('countLabel'), count: boom('count') }));
vi.mock('@/lib/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/pricing')>()),
  priceFor: boom('priceFor'),
}));

import { degradedText, degradedUrl, manualSummaryText } from '@/components/builder/degraded';
import type { SummaryData } from '@/components/builder/logic';
import {
  safeCountLabel,
  safeDerive,
  safeFormatCm,
  safeLayout,
  safeMaxWidth,
  safeParseCm,
  safePrice,
  safeShapeLabel,
  safeSizeLabel,
} from '@/components/builder/safe';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { Shape } from '@/lib/types';
import { show, visible } from './_util';

const SUMMARIES: Record<string, SummaryData> = {
  'circle priced with discount': {
    shape: 'circle',
    corners: undefined,
    widthUm: 30_000,
    heightUm: 30_000,
    countPerSheet: 54,
    sheets: 20,
    material: 'paper',
    totalStickers: 1_080,
    unitPriceIqd: 720,
    discountPercent: 10,
    subtotalIqd: 14_400,
    deliveryFeeIqd: 5_000,
    totalIqd: 19_400,
  },
  'rect rounded unpriced': {
    shape: 'rect',
    corners: 'rounded',
    widthUm: 50_000,
    heightUm: 30_000,
    countPerSheet: 27,
    sheets: 10,
    material: 'plastic',
    totalStickers: 270,
    unitPriceIqd: null,
    discountPercent: 0,
    subtotalIqd: null,
    deliveryFeeIqd: 5_000,
    totalIqd: null,
  },
  'rect sharp priced no discount': {
    shape: 'rect',
    corners: 'sharp',
    widthUm: 42_420,
    heightUm: 30_000,
    countPerSheet: 36,
    sheets: 10,
    material: 'plastic',
    totalStickers: 360,
    unitPriceIqd: 1_500,
    discountPercent: 0,
    subtotalIqd: 15_000,
    deliveryFeeIqd: 5_000,
    totalIqd: 20_000,
  },
  'custom odd size': {
    shape: 'custom',
    corners: undefined,
    widthUm: 12_345,
    heightUm: 6_789,
    countPerSheet: 200,
    sheets: 100,
    material: 'paper',
    totalStickers: 20_000,
    unitPriceIqd: 640,
    discountPercent: 20,
    subtotalIqd: 64_000,
    deliveryFeeIqd: 5_000,
    totalIqd: 69_000,
  },
};

describe('golden: safe.ts fallbacks when the wrapped module throws', () => {
  it('samples', () => {
    const L = DEFAULT_SETTINGS.layout;
    const shapes: Shape[] = ['circle', 'rect', 'custom'];
    expect({
      safeParseCm: ['3', 'abc'].map((s) => `${show(s)}=>${show(safeParseCm(s))}`),
      safeFormatCm: [30_000, 42_420, 42_450, 12_345, 49, 50, 0, -30_000].map((n) => `${n}=>${show(safeFormatCm(n))}`),
      safeLayout: safeLayout({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }, L),
      safeDerive: [
        safeDerive('circle', 2, { widthUm: 30_000 }),
        safeDerive('circle', 2, { heightUm: 30_000 }),
        safeDerive('rect', 1.5, { widthUm: 30_000 }),
        safeDerive('rect', 1.5, { heightUm: 30_000 }),
        safeDerive('custom', 0.7071, { widthUm: 42_420 }),
        safeDerive('custom', Number.NaN, { heightUm: 30_000 }),
        safeDerive('custom', 0, { widthUm: 30_000 }),
        safeDerive('custom', -2, { heightUm: 30_000 }),
        safeDerive('rect', Number.POSITIVE_INFINITY, { widthUm: 30_000 }),
        safeDerive('rect', 3, { widthUm: 0 }),
        safeDerive('rect', 3, { widthUm: 10.5 }),
      ],
      safeMaxWidth: safeMaxWidth(1, { shape: 'circle', widthUm: 1, heightUm: 1 }, L),
      safeCountLabel: [0, 1, 54].map((n) => safeCountLabel(n)),
      safePrice: [safePrice('paper', 20, 54, DEFAULT_SETTINGS), safePrice('plastic', 50, 0, { ...DEFAULT_SETTINGS, deliveryFeeIqd: 0 })],
      safeShapeLabel: shapes.flatMap((s) => [undefined, 'rounded' as const, 'sharp' as const].map((c) => `${s}/${String(c)}=>${safeShapeLabel(s, c)}`)),
      safeSizeLabel: [safeSizeLabel(30_000, 30_000), safeSizeLabel(42_420, 30_000), safeSizeLabel(12_345, 6_789)],
    }).toMatchSnapshot();
  });
});

describe('golden: degraded.ts falls back to the manual summary', () => {
  it('manualSummaryText / degradedText / degradedUrl', () => {
    const out: Record<string, unknown> = {};
    for (const [name, s] of Object.entries(SUMMARIES)) {
      const url = degradedUrl('9647709999999', s);
      out[name] = {
        manual: visible(manualSummaryText(s)),
        degradedIsIntroPlusManual: degradedText(s).endsWith(`\n${manualSummaryText(s)}`),
        degraded: visible(degradedText(s)),
        url,
      };
    }
    expect(out).toMatchSnapshot();
  });
});
