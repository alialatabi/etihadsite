import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/parse/phone', () => ({
  normalisePhone: (s: string) => {
    const d = s.replace(/\D/g, '').replace(/^0+/, '');
    return /^7\d{9}$/.test(d) ? `964${d}` : null;
  },
  whatsappUrl: (n: string, t?: string) => `https://wa.me/${n}${t ? `?text=${encodeURIComponent(t)}` : ''}`,
}));
vi.mock('@/lib/order-text', () => ({
  orderSummaryText: () => {
    throw new Error('NOT_IMPLEMENTED');
  },
  shapeLabel: () => {
    throw new Error('NOT_IMPLEMENTED');
  },
  sizeLabel: () => {
    throw new Error('NOT_IMPLEMENTED');
  },
}));
vi.mock('@/lib/parse/cm', () => ({
  parseCm: (s: string) => (Number(s) > 0 ? Math.round(Number(s) * 10000) : null),
  formatCm: (um: number) => String(um / 10000),
}));

import { degradedText, degradedUrl } from '@/components/builder/degraded';
import {
  activeTier,
  clampSheets,
  dpiExact,
  dpiFor,
  dpiStatus,
  needsCropNotice,
  nextTierNudge,
  parseSheets,
  pdfPrefillUm,
  quickPicksFor,
  validateCustomer,
} from '@/components/builder/logic';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { validateQuantity } from '@/lib/pricing';
import type { DesignSource, StickerSpec } from '@/lib/types';

const design = (over: Partial<DesignSource>): DesignSource =>
  ({ kind: 'png', file: new File([], 'a.png'), pxWidth: 900, pxHeight: 900, hasAlpha: false, previewUrl: 'blob:x', ...over }) as DesignSource;
const spec = (w: number, shape: StickerSpec['shape'] = 'rect'): StickerSpec => ({ shape, widthUm: w, heightUm: w });

describe('dpi', () => {
  it('computes effective dpi over the ordered width', () => {
    expect(dpiFor(design({}), spec(76_200))).toBe(300); // 900 px over 3 in
  });
  it('skips vector PDFs', () => {
    expect(dpiFor(design({ kind: 'pdf' }), spec(30_000))).toBeNull();
  });
  it('uses the short side for circles', () => {
    expect(dpiFor(design({ pxWidth: 1800, pxHeight: 900 }), spec(76_200, 'circle'))).toBe(300);
  });
  it('gates on the UNROUNDED dpi like the server (71.9 dpi is blocked at blockDpi 72)', () => {
    const q = { warnDpi: 150, blockDpi: 72, targetDpi: 300 };
    // 71.9 dpi: 719 px over 10 in (254 000 um)
    const d = design({ pxWidth: 719, pxHeight: 719 });
    const s = spec(254_000);
    expect(dpiExact(d, s)).toBeCloseTo(71.9, 6);
    expect(dpiStatus(dpiFor(d, s), q)).toBe('block');
    // 149.6 dpi: warn, not ok
    expect(dpiStatus(dpiFor(design({ pxWidth: 1496, pxHeight: 1496 }), s), q)).toBe('warn');
    // exactly on the threshold passes
    expect(dpiStatus(dpiFor(design({ pxWidth: 720, pxHeight: 720 }), s), q)).toBe('warn');
    expect(dpiStatus(dpiFor(design({ pxWidth: 1500, pxHeight: 1500 }), s), q)).toBe('ok');
  });
  it('classifies against quality settings', () => {
    const q = { warnDpi: 150, blockDpi: 72, targetDpi: 300 };
    expect(dpiStatus(null, q)).toBe('ok');
    expect(dpiStatus(200, q)).toBe('ok');
    expect(dpiStatus(100, q)).toBe('warn');
    expect(dpiStatus(50, q)).toBe('block');
  });
});

describe('pdf prefill + crop notice', () => {
  it('converts pt to um', () => {
    const d = design({ kind: 'pdf', pdf: { pageCount: 1, pageWidthPt: 72, pageHeightPt: 144 } });
    expect(pdfPrefillUm(d, 'rect')).toEqual({ widthUm: 25_400, heightUm: 50_800 });
    expect(pdfPrefillUm(d, 'circle')).toEqual({ widthUm: 25_400, heightUm: 25_400 });
  });
  it('flags non-square circle art only', () => {
    expect(needsCropNotice('circle', design({ pxWidth: 1000, pxHeight: 500 }))).toBe(true);
    expect(needsCropNotice('circle', design({}))).toBe(false);
    expect(needsCropNotice('rect', design({ pxWidth: 1000, pxHeight: 500 }))).toBe(false);
  });
});

describe('validateCustomer', () => {
  const ok = { name: '', phone: '0770 123 4567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجامع', notes: '' };
  it('accepts a valid customer', () => {
    const r = validateCustomer(ok);
    expect(r.errors).toEqual({});
    expect(r.phoneE164).toBe('9647701234567');
  });
  it('flags every missing required field', () => {
    const r = validateCustomer({ ...ok, phone: '12', governorate: '', district: ' ', landmark: '' });
    expect(Object.keys(r.errors).sort()).toEqual(['district', 'governorate', 'landmark', 'phone']);
  });
});

describe('degraded WhatsApp text', () => {
  const summary = {
    shape: 'circle' as const,
    widthUm: 30_000,
    heightUm: 30_000,
    countPerSheet: 54,
    sheets: 20,
    totalStickers: 1080,
    material: 'paper' as const,
    unitPriceIqd: null,
    discountPercent: 0,
    subtotalIqd: null,
    deliveryFeeIqd: 5000,
    totalIqd: null,
  };
  it('falls back to a manual summary when orderSummaryText throws', () => {
    const t = degradedText(summary);
    expect(t.split('\n').length).toBeGreaterThan(5);
    expect(t).toContain('1080');
  });
  it('returns null without a whatsapp number', () => {
    expect(degradedUrl('', summary)).toBeNull();
    expect(degradedUrl('9647701234567', summary)).toMatch(/^https:\/\/wa\.me\/9647701234567\?text=/);
  });
});

describe('quantity logic', () => {
  const pricing = DEFAULT_SETTINGS.pricing;

  it('parses typed text, incl. Arabic-Indic digits', () => {
    expect(parseSheets('25')).toBe(25);
    expect(parseSheets(' ٢٠ ')).toBe(20);
    expect(parseSheets('')).toBeNull();
    expect(parseSheets('abc')).toBeNull();
    expect(parseSheets('12.5')).toBe(12.5);
  });

  it('clamps into min..max and rounds', () => {
    expect(clampSheets(3, pricing)).toBe(10);
    expect(clampSheets(9999, pricing)).toBe(pricing.maxSheets);
    expect(clampSheets(24.6, pricing)).toBe(25);
    expect(clampSheets(Number.NaN, pricing)).toBe(10);
  });

  it('validates quantity against settings', () => {
    expect(validateQuantity('paper', 10, pricing)).toBeNull();
    expect(validateQuantity('paper', 9, pricing)).toBe('below_min');
    expect(validateQuantity('paper', 10.5, pricing)).toBe('not_integer');
    expect(validateQuantity('paper', pricing.maxSheets + 1, pricing)).toBe('above_max');
  });

  it('keeps only quick picks inside min..max, unique and sorted', () => {
    expect(quickPicksFor({ minSheets: 10, maxSheets: 100, quickPicks: [200, 50, 5, 10, 50, 20.5] })).toEqual([10, 50]);
    expect(quickPicksFor(pricing)).toEqual([10, 20, 50, 100]);
  });

  it('finds the tier reached', () => {
    expect(activeTier(10, pricing.tiers)).toBeNull();
    expect(activeTier(20, pricing.tiers)?.percent).toBe(10);
    expect(activeTier(99, pricing.tiers)?.percent).toBe(15);
    expect(activeTier(100, pricing.tiers)?.percent).toBe(20);
    expect(activeTier(null, pricing.tiers)).toBeNull();
  });

  it('nudges only when the next tier is close', () => {
    expect(nextTierNudge(10, pricing.tiers)).toBeNull(); // 10 away from 20 (> 5)
    expect(nextTierNudge(15, pricing.tiers)).toEqual({ add: 5, percent: 10 });
    expect(nextTierNudge(45, pricing.tiers)).toEqual({ add: 5, percent: 15 });
    expect(nextTierNudge(40, pricing.tiers)).toEqual({ add: 10, percent: 15 }); // 25% of 50 = 13
    expect(nextTierNudge(100, pricing.tiers)).toBeNull();
    expect(nextTierNudge(null, pricing.tiers)).toBeNull();
  });
});
