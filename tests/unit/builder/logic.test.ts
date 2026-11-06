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
import { dpiFor, dpiStatus, needsCropNotice, pdfPrefillUm, validateCustomer } from '@/components/builder/logic';
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
    offerPriceIqd: null,
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
