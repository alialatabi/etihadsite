import { describe, expect, it } from 'vitest';
import { orderSummaryText, shapeLabel, sizeLabel } from './order-text';
import type { OrderSummary } from '@/lib/types';

const base: OrderSummary = {
  displayNo: 'EP-251107-AB3C',
  shape: 'circle',
  widthUm: 30_000,
  heightUm: 30_000,
  countPerSheet: 54,
  sheets: 20,
  totalStickers: 1080,
  offerPriceIqd: null,
  deliveryFeeIqd: 5_000,
  totalIqd: null,
};

describe('orderSummaryText', () => {
  it('matches the documented example when price is unset', () => {
    expect(orderSummaryText(base)).toBe(
      [
        'طلب جديد — EP-251107-AB3C',
        'الشكل: دائري',
        'القياس: 3 × 3 سم',
        'بالورقة: 54 ستيكر',
        'الأوراق: 20 ورقة (1080 ستيكر)',
        'السعر: يُحدد عند التأكيد',
        'التوصيل: 5,000 د.ع',
      ].join('\n'),
    );
  });
  it('shows prices and total when known', () => {
    const t = orderSummaryText({
      ...base,
      shape: 'rect',
      corners: 'sharp',
      widthUm: 30_000,
      heightUm: 42_420,
      countPerSheet: 1,
      sheets: 2,
      totalStickers: 2,
      offerPriceIqd: 40_000,
      totalIqd: 45_000,
    });
    expect(t).toBe(
      [
        'طلب جديد — EP-251107-AB3C',
        'الشكل: مستطيل بزوايا حادة',
        'القياس: 3 × 4.24 سم',
        'بالورقة: 1 ستيكر',
        'الأوراق: 2 ورقتين (2 ستيكرين)',
        'السعر: 40,000 د.ع',
        'التوصيل: 5,000 د.ع',
        'الإجمالي: 45,000 د.ع',
      ].join('\n'),
    );
  });
});

describe('labels', () => {
  it('shapeLabel', () => {
    expect(shapeLabel('circle')).toBe('دائري');
    expect(shapeLabel('rect', 'rounded')).toBe('مستطيل بزوايا دائرية');
    expect(shapeLabel('rect', 'sharp')).toBe('مستطيل بزوايا حادة');
    expect(shapeLabel('rect')).toBe('مستطيل بزوايا دائرية');
    expect(shapeLabel('custom')).toBe('شكل مخصص');
  });
  it('sizeLabel', () => {
    expect(sizeLabel(30_000, 30_000)).toBe('3 × 3 سم');
    expect(sizeLabel(30_000, 42_420)).toBe('3 × 4.24 سم');
  });
});
