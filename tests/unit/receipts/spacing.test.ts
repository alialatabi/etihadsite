/**
 * Receipt spacing model (src/lib/receipts/formats.ts): the owner's defaults, custom values, the
 * leftover-micrometre rule and the fit check. The pinned slot numbers of the live table are in
 * formats.test.ts; here they are reached through `defaultSpacing`.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SPACING_UM,
  MIN_SLOT_UM,
  RECEIPT_FORMATS,
  RECEIPT_FORMAT_IDS,
  RECEIPT_GRID,
  defaultSpacing,
  receiptSlots,
  spacingFits,
  swapWhiteSpacing,
  type ReceiptFormat,
  type ReceiptSlot,
  type ReceiptSpacing,
} from '@/lib/receipts/formats';
import { A4_UM } from '@/lib/units';

const rect = (xUm: number, yUm: number, widthUm: number, heightUm: number): ReceiptSlot => ({ xUm, yUm, widthUm, heightUm });
const sp = (format: ReceiptFormat, over: Partial<ReceiptSpacing> = {}, white: 'top' | 'bottom' = 'top'): ReceiptSpacing => ({ ...defaultSpacing(format, white), ...over });

function expectSane(slots: ReceiptSlot[]) {
  for (const s of slots) {
    expect(Object.values(s).every(Number.isInteger)).toBe(true);
    expect(s.xUm).toBeGreaterThanOrEqual(0);
    expect(s.yUm).toBeGreaterThanOrEqual(0);
    expect(s.xUm + s.widthUm).toBeLessThanOrEqual(A4_UM.widthUm);
    expect(s.yUm + s.heightUm).toBeLessThanOrEqual(A4_UM.heightUm);
    expect([s.widthUm, s.heightUm]).toEqual([slots[0].widthUm, slots[0].heightUm]); // equal sizes
  }
  slots.forEach((a, i) =>
    slots.slice(i + 1).forEach((b) => {
      const apart = a.xUm + a.widthUm <= b.xUm || b.xUm + b.widthUm <= a.xUm || a.yUm + a.heightUm <= b.yUm || b.yUm + b.heightUm <= a.yUm;
      expect(apart).toBe(true);
    }),
  );
}

describe('defaults', () => {
  it('the owner numbers, one by one', () => {
    expect(defaultSpacing('a4')).toEqual({ topUm: 12_000, rightUm: 0, bottomUm: 0, leftUm: 0, gapXUm: 0, gapYUm: 0 });
    expect(defaultSpacing('a5')).toEqual({ topUm: 0, rightUm: 0, bottomUm: 0, leftUm: 15_000, gapXUm: 0, gapYUm: 8_000 });
    expect(defaultSpacing('dl')).toEqual({ topUm: 0, rightUm: 0, bottomUm: 0, leftUm: 15_000, gapXUm: 0, gapYUm: 8_000 });
    expect(defaultSpacing('a6', 'top')).toEqual({ topUm: 7_000, rightUm: 0, bottomUm: 0, leftUm: 0, gapXUm: 7_220, gapYUm: 7_360 });
    expect(defaultSpacing('a6', 'bottom')).toEqual({ topUm: 0, rightUm: 0, bottomUm: 7_000, leftUm: 0, gapXUm: 7_220, gapYUm: 7_360 });
  });
  it('the white side only matters for a6', () => {
    for (const f of ['a4', 'a5', 'dl'] as const) expect(defaultSpacing(f, 'bottom')).toEqual(defaultSpacing(f, 'top'));
    expect(defaultSpacing('a6')).toEqual(defaultSpacing('a6', 'top'));
  });
  it('every default fits, and the table sizes are the default slot sizes', () => {
    for (const f of RECEIPT_FORMAT_IDS) {
      for (const w of ['top', 'bottom'] as const) {
        expect(spacingFits(f, defaultSpacing(f, w))).toBe(true);
        const slots = receiptSlots(f, defaultSpacing(f, w));
        expect(slots).toHaveLength(RECEIPT_FORMATS[f].perSheet);
        expect([slots[0].widthUm, slots[0].heightUm]).toEqual([RECEIPT_FORMATS[f].widthUm, RECEIPT_FORMATS[f].heightUm]);
        expectSane(slots);
      }
    }
  });
  it('grid: columns x rows per format', () => {
    expect(RECEIPT_GRID).toEqual({ a4: { cols: 1, rows: 1 }, a5: { cols: 1, rows: 2 }, dl: { cols: 1, rows: 3 }, a6: { cols: 2, rows: 2 } });
    for (const f of RECEIPT_FORMAT_IDS) expect(RECEIPT_GRID[f].cols * RECEIPT_GRID[f].rows).toBe(RECEIPT_FORMATS[f].perSheet);
  });
  it('limits: 100 mm per value, 20 mm per slot', () => {
    expect(MAX_SPACING_UM).toBe(100_000);
    expect(MIN_SLOT_UM).toBe(20_000);
  });
});

describe('custom spacing', () => {
  it('a5 with 10 mm on the left and 5 mm between', () => {
    // rows: avail 297000 - 5000 = 292000 -> 146000 each; width 210000 - 10000
    const slots = receiptSlots('a5', sp('a5', { leftUm: 10_000, gapYUm: 5_000 }));
    expect(slots).toEqual([rect(10_000, 0, 200_000, 146_000), rect(10_000, 151_000, 200_000, 146_000)]);
    expectSane(slots);
  });
  it('a6 with no gaps at all', () => {
    // rows: avail 297000 - 7000 = 290000 -> 145000; columns: 210000 -> 105000
    const slots = receiptSlots('a6', sp('a6', { gapXUm: 0, gapYUm: 0 }));
    expect(slots).toEqual([rect(0, 7_000, 105_000, 145_000), rect(105_000, 7_000, 105_000, 145_000), rect(0, 152_000, 105_000, 145_000), rect(105_000, 152_000, 105_000, 145_000)]);
    expectSane(slots);
  });
  it('a6: the column gap and the row gap are separate', () => {
    const [a, b, c] = receiptSlots('a6', sp('a6', { gapXUm: 10_000, gapYUm: 2_000 }));
    expect(b.xUm - (a.xUm + a.widthUm)).toBe(10_000);
    expect(c.yUm - (a.yUm + a.heightUm)).toBe(2_000);
  });
  it('dl with 5 mm on the top and the bottom', () => {
    // avail 297000 - 10000 - 16000 = 271000 -> cell 90333, leftover 1 goes to the first gap
    const slots = receiptSlots('dl', sp('dl', { topUm: 5_000, bottomUm: 5_000 }));
    expect(slots.map((s) => s.heightUm)).toEqual([90_333, 90_333, 90_333]);
    expect(slots.map((s) => s.yUm)).toEqual([5_000, 5_000 + 90_333 + 8_001, 5_000 + 2 * 90_333 + 2 * 8_000 + 1]);
    expect(A4_UM.heightUm - (slots[2].yUm + slots[2].heightUm)).toBe(5_000);
    expectSane(slots);
  });
  it('right and bottom are the physical sides of the page', () => {
    expect(receiptSlots('a4', sp('a4', { topUm: 0, rightUm: 20_000, bottomUm: 30_000, leftUm: 10_000 }))).toEqual([rect(10_000, 0, 180_000, 267_000)]);
  });
  it('the leftover micrometres go to the first gaps, one each', () => {
    expect(receiptSlots('dl', defaultSpacing('dl')).map((s) => s.yUm)).toEqual([0, 101_667, 203_334]); // leftover 2
    const one = receiptSlots('dl', sp('dl', { topUm: 1_000 })); // avail 280000 -> 93333, leftover 1
    expect(one[1].yUm - (one[0].yUm + one[0].heightUm)).toBe(8_001);
    expect(one[2].yUm - (one[1].yUm + one[1].heightUm)).toBe(8_000);
  });
  it('a gap that does not apply is ignored', () => {
    expect(receiptSlots('a4', sp('a4', { gapXUm: 50_000, gapYUm: 50_000 }))).toEqual(receiptSlots('a4', defaultSpacing('a4')));
    expect(receiptSlots('a5', sp('a5', { gapXUm: 50_000 }))).toEqual(receiptSlots('a5', defaultSpacing('a5')));
    expect(receiptSlots('dl', sp('dl', { gapXUm: 50_000 }))).toEqual(receiptSlots('dl', defaultSpacing('dl')));
  });
  it('a sweep of odd values stays inside the page with equal sizes and no overlap', () => {
    for (const f of RECEIPT_FORMAT_IDS) {
      for (const v of [0, 1_000, 3_333, 7_777, 20_000]) {
        const s = { topUm: v, rightUm: v + 1, bottomUm: v + 2, leftUm: v + 3, gapXUm: v + 4, gapYUm: v + 5 };
        expect(spacingFits(f, s)).toBe(true);
        expectSane(receiptSlots(f, s));
      }
    }
  });
});

describe('spacingFits', () => {
  it('a slot narrower than 20 mm is no room (exactly 20 mm is fine)', () => {
    expect(spacingFits('a4', sp('a4', { leftUm: 100_000, rightUm: 91_000 }))).toBe(false); // 19 mm wide
    expect(spacingFits('a4', sp('a4', { leftUm: 100_000, rightUm: 90_000 }))).toBe(true); // 20 mm
  });
  it('a slot shorter than 20 mm is no room', () => {
    // a4 height 297000: top 100000, bottom 100000 -> 97000 tall: fits
    expect(spacingFits('a4', sp('a4', { topUm: 100_000, bottomUm: 100_000 }))).toBe(true);
    // dl: top + bottom 200000 + 2 gaps of 100000 -> negative height
    expect(spacingFits('dl', sp('dl', { topUm: 100_000, bottomUm: 100_000, gapYUm: 100_000 }))).toBe(false);
    // dl: 297000 - 100000 - 100000 - 16000 = 81000 / 3 = 27000: fits
    expect(spacingFits('dl', sp('dl', { topUm: 100_000, bottomUm: 100_000 }))).toBe(true);
    // a6 rows: 297000 - 300000 < 0
    expect(spacingFits('a6', sp('a6', { topUm: 100_000, bottomUm: 100_000, gapYUm: 100_000 }))).toBe(false);
  });
  it('a slot with a positive height under 20 mm is no room (exactly 20 mm is fine)', () => {
    // dl: (297000 - 100000 - 100000 - 2 * 20000) / 3 = 19000 tall
    expect(spacingFits('dl', sp('dl', { topUm: 100_000, bottomUm: 100_000, gapYUm: 20_000 }))).toBe(false);
    // dl: (297000 - 200000 - 2 * 18500) / 3 = 20000 tall
    expect(spacingFits('dl', sp('dl', { topUm: 100_000, bottomUm: 100_000, gapYUm: 18_500 }))).toBe(true);
    // a5: (297000 - 200000 - 60000) / 2 = 18500 tall
    expect(spacingFits('a5', sp('a5', { topUm: 100_000, bottomUm: 100_000, gapYUm: 60_000 }))).toBe(false);
    // a5: (297000 - 200000 - 57000) / 2 = 20000 tall
    expect(spacingFits('a5', sp('a5', { topUm: 100_000, bottomUm: 100_000, gapYUm: 57_000 }))).toBe(true);
  });
  it('a6 columns: left and the column gap can leave no room', () => {
    expect(spacingFits('a6', sp('a6', { gapXUm: 100_000, leftUm: 100_000 }))).toBe(false); // (210000 - 200000) / 2 = 5000
    expect(spacingFits('a6', sp('a6', { gapXUm: 100_000 }))).toBe(true); // 55000 each
  });
  it('a value above 100 mm, negative or not a whole number is refused', () => {
    expect(spacingFits('a4', sp('a4', { topUm: 100_000 }))).toBe(true);
    expect(spacingFits('a4', sp('a4', { topUm: 100_001 }))).toBe(false);
    expect(spacingFits('a4', sp('a4', { topUm: -1 }))).toBe(false);
    expect(spacingFits('a4', sp('a4', { leftUm: 0.5 }))).toBe(false);
    expect(spacingFits('a4', sp('a4', { topUm: Number.NaN }))).toBe(false);
    // a value the format does not use is still a value of the object
    expect(spacingFits('a4', sp('a4', { gapXUm: 100_001 }))).toBe(false);
    expect(spacingFits('a4', sp('a4', { gapYUm: -1 }))).toBe(false);
  });
});

describe('swapWhiteSpacing', () => {
  it('swaps top and bottom only; twice is the identity', () => {
    const s = sp('a6', { topUm: 3_000, bottomUm: 9_000, leftUm: 1_000 });
    expect(swapWhiteSpacing(s)).toEqual({ ...s, topUm: 9_000, bottomUm: 3_000 });
    expect(swapWhiteSpacing(swapWhiteSpacing(s))).toEqual(s);
    expect(swapWhiteSpacing(defaultSpacing('a6', 'top'))).toEqual(defaultSpacing('a6', 'bottom'));
  });
});
