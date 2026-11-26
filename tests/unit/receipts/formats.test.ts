/** Receipt formats (src/lib/receipts/formats.ts): the owner's slot table is pinned number by number. */
import { describe, expect, it } from 'vitest';
import {
  RECEIPT_FORMATS,
  RECEIPT_FORMAT_IDS,
  autoTurn,
  autoWhite,
  defaultSpacing,
  guessReceiptFormat,
  nextTurn,
  receiptSlots,
  slotIsLandscape,
  type ReceiptFormat,
  type ReceiptSlot,
  type ReceiptTurn,
} from '@/lib/receipts/formats';
import { A4_UM } from '@/lib/units';

const rect = (xUm: number, yUm: number, widthUm: number, heightUm: number): ReceiptSlot => ({ xUm, yUm, widthUm, heightUm });

describe('slot table (spec B1)', () => {
  it('a4: one 21 x 28.5 slot, 12 mm of white at the top', () => {
    expect(receiptSlots('a4', defaultSpacing('a4'))).toEqual([rect(0, 12_000, 210_000, 285_000)]);
  });
  it('a5: two 15 x 19.5 slots, 15 mm white on the left, 8 mm between', () => {
    expect(receiptSlots('a5', defaultSpacing('a5'))).toEqual([rect(15_000, 0, 195_000, 144_500), rect(15_000, 152_500, 195_000, 144_500)]);
  });
  it('dl: three 19.5 x 10 slots, 15 mm white on the left', () => {
    expect(receiptSlots('dl', defaultSpacing('dl'))).toEqual([
      rect(15_000, 0, 195_000, 93_666),
      rect(15_000, 101_667, 195_000, 93_666),
      rect(15_000, 203_334, 195_000, 93_666),
    ]);
  });
  it('a6, white at the top: 4 quarters from y 7000 and 155680, columns at 0 and 108610', () => {
    expect(receiptSlots('a6', defaultSpacing('a6', 'top'))).toEqual([
      rect(0, 7_000, 101_390, 141_320),
      rect(108_610, 7_000, 101_390, 141_320),
      rect(0, 155_680, 101_390, 141_320),
      rect(108_610, 155_680, 101_390, 141_320),
    ]);
  });
  it('a6, white at the bottom: the mirrored rows 0 and 148680', () => {
    expect(receiptSlots('a6', defaultSpacing('a6', 'bottom'))).toEqual([
      rect(0, 0, 101_390, 141_320),
      rect(108_610, 0, 101_390, 141_320),
      rect(0, 148_680, 101_390, 141_320),
      rect(108_610, 148_680, 101_390, 141_320),
    ]);
  });
  it('the other formats ignore the white side', () => {
    for (const f of ['a4', 'a5', 'dl'] as const) expect(receiptSlots(f, defaultSpacing(f, 'bottom'))).toEqual(receiptSlots(f, defaultSpacing(f, 'top')));
  });
  it('per-sheet counts match the slot lists, and the table sizes match the slots', () => {
    for (const f of RECEIPT_FORMAT_IDS) {
      const slots = receiptSlots(f, defaultSpacing(f));
      expect(slots).toHaveLength(RECEIPT_FORMATS[f].perSheet);
      for (const s of slots) expect([s.widthUm, s.heightUm]).toEqual([RECEIPT_FORMATS[f].widthUm, RECEIPT_FORMATS[f].heightUm]);
    }
    expect(RECEIPT_FORMAT_IDS.map((f) => RECEIPT_FORMATS[f].perSheet)).toEqual([1, 2, 4, 3]);
  });
  it('orientation: a5 and dl landscape, a4 and a6 portrait', () => {
    expect(RECEIPT_FORMAT_IDS.map((f) => slotIsLandscape(f))).toEqual([false, true, false, true]);
  });
  it('every slot is inside the page, none overlap, whole numbers only', () => {
    for (const f of RECEIPT_FORMAT_IDS) {
      for (const white of ['top', 'bottom'] as const) {
        const slots = receiptSlots(f, defaultSpacing(f, white));
        for (const s of slots) {
          expect(Object.values(s).every(Number.isInteger)).toBe(true);
          expect(s.xUm).toBeGreaterThanOrEqual(0);
          expect(s.yUm).toBeGreaterThanOrEqual(0);
          expect(s.xUm + s.widthUm).toBeLessThanOrEqual(A4_UM.widthUm);
          expect(s.yUm + s.heightUm).toBeLessThanOrEqual(A4_UM.heightUm);
        }
        slots.forEach((a, i) =>
          slots.slice(i + 1).forEach((b) => {
            const apart = a.xUm + a.widthUm <= b.xUm || b.xUm + b.widthUm <= a.xUm || a.yUm + a.heightUm <= b.yUm || b.yUm + b.heightUm <= a.yUm;
            expect(apart).toBe(true);
          }),
        );
      }
    }
  });
  it('white and gaps as the owner wrote them', () => {
    const a4 = receiptSlots('a4', defaultSpacing('a4'))[0];
    expect(a4.yUm).toBe(12_000); // white at the top
    expect(A4_UM.heightUm - (a4.yUm + a4.heightUm)).toBe(0);
    const a5 = receiptSlots('a5', defaultSpacing('a5'));
    expect(a5[0].xUm).toBe(15_000); // white on the left
    expect(a5[1].yUm - (a5[0].yUm + a5[0].heightUm)).toBe(8_000); // 8 mm between
    expect(a5[1].yUm + a5[1].heightUm).toBe(A4_UM.heightUm);
    const dl = receiptSlots('dl', defaultSpacing('dl'));
    expect(dl[0].xUm).toBe(15_000);
    expect(dl[1].yUm - (dl[0].yUm + dl[0].heightUm)).toBe(8_001);
    expect(dl[2].yUm - (dl[1].yUm + dl[1].heightUm)).toBe(8_001);
    expect(dl[2].yUm + dl[2].heightUm).toBe(A4_UM.heightUm);
    const top = receiptSlots('a6', defaultSpacing('a6', 'top'));
    expect(top[0].yUm).toBe(7_000); // 7 mm of white per quarter
    expect(top[2].yUm - (top[0].yUm + top[0].heightUm)).toBe(7_360); // between the rows
    expect(top[2].yUm + top[2].heightUm).toBe(A4_UM.heightUm);
    expect(top[1].xUm - (top[0].xUm + top[0].widthUm)).toBe(7_220); // 7.22 mm between the columns
    expect(top[1].xUm + top[1].widthUm).toBe(A4_UM.widthUm);
    const bottom = receiptSlots('a6', defaultSpacing('a6', 'bottom'));
    expect(bottom[0].yUm).toBe(0);
    expect(A4_UM.heightUm - (bottom[2].yUm + bottom[2].heightUm)).toBe(7_000);
  });
});

describe('autoTurn / autoWhite / nextTurn', () => {
  const portrait = { pxWidth: 1000, pxHeight: 1400 };
  const landscape = { pxWidth: 1400, pxHeight: 1000 };
  const square = { pxWidth: 1000, pxHeight: 1000 };

  it('same orientation: 0; different: 270 (counter-clockwise)', () => {
    expect(autoTurn('a4', portrait)).toBe(0);
    expect(autoTurn('a6', portrait)).toBe(0);
    expect(autoTurn('a5', landscape)).toBe(0);
    expect(autoTurn('dl', landscape)).toBe(0);
    expect(autoTurn('a5', portrait)).toBe(270);
    expect(autoTurn('dl', portrait)).toBe(270);
    expect(autoTurn('a4', landscape)).toBe(270);
    expect(autoTurn('a6', landscape)).toBe(270);
  });
  it('a square design counts as portrait', () => {
    expect(autoTurn('a4', square)).toBe(0);
    expect(autoTurn('a6', square)).toBe(0);
    expect(autoTurn('a5', square)).toBe(270);
    expect(autoTurn('dl', square)).toBe(270);
  });
  it('white: top for 0/180, bottom for 90/270', () => {
    const turns: ReceiptTurn[] = [0, 90, 180, 270];
    expect(turns.map((t) => autoWhite(t))).toEqual(['top', 'bottom', 'top', 'bottom']);
  });
  it('nextTurn adds 90 clockwise and wraps', () => {
    expect([nextTurn(0), nextTurn(90), nextTurn(180), nextTurn(270)]).toEqual([90, 180, 270, 0]);
  });
});

describe('guessReceiptFormat', () => {
  const raster = (w: number, h: number) => ({ pxWidth: w, pxHeight: h });
  const pdf = (mmW: number, mmH: number) => {
    const pt = (mm: number) => (mm / 25.4) * 72;
    return { pxWidth: pt(mmW), pxHeight: pt(mmH), pdf: { pageCount: 1, pageWidthPt: pt(mmW), pageHeightPt: pt(mmH) } };
  };

  it('a format token in the file name wins', () => {
    expect(guessReceiptFormat('10 a5 mk ديكور ارام.pdf', raster(1000, 1000))).toBe('a5');
    expect(guessReceiptFormat('15 dl mk دار بغداد.pdf', raster(1000, 1000))).toBe('dl');
    expect(guessReceiptFormat('Receipt_A6_final.PNG', raster(1000, 1000))).toBe('a6');
    expect(guessReceiptFormat('وصل-a4.jpg', raster(1000, 1000))).toBe('a4');
    expect(guessReceiptFormat('x DL.pdf', raster(1000, 1000))).toBe('dl');
  });
  it('a token inside a longer Latin word or number does not count', () => {
    // The name is ignored, so the aspect decides.
    expect(guessReceiptFormat('logo-a55.pdf', raster(1950, 1000))).toBe('dl');
    expect(guessReceiptFormat('logo-a55.pdf', raster(1500, 1000))).toBe('a6');
    expect(guessReceiptFormat('data5.pdf', raster(1500, 1000))).toBe('a6');
    expect(guessReceiptFormat('hola4.png', raster(1500, 1000))).toBe('a6');
    expect(guessReceiptFormat('bundle.png', raster(1950, 1000))).toBe('dl');
    expect(guessReceiptFormat('a4a5.png', raster(1950, 1000))).toBe('dl');
  });
  it('a PDF page size within 15 % of a nominal size picks that format', () => {
    expect(guessReceiptFormat('x.pdf', pdf(210, 285))).toBe('a4');
    expect(guessReceiptFormat('x.pdf', pdf(210, 297))).toBe('a4');
    expect(guessReceiptFormat('x.pdf', pdf(150, 195))).toBe('a5');
    expect(guessReceiptFormat('x.pdf', pdf(195, 150))).toBe('a5'); // sides sorted
    expect(guessReceiptFormat('x.pdf', pdf(100, 150))).toBe('a6');
    expect(guessReceiptFormat('x.pdf', pdf(195, 100))).toBe('dl');
    expect(guessReceiptFormat('x.pdf', pdf(103, 153))).toBe('a6'); // a little bleed
  });
  it('the physical size beats the aspect when both are known', () => {
    expect(guessReceiptFormat('x.pdf', { ...pdf(100, 150), pxWidth: 195, pxHeight: 100 })).toBe('a6');
  });
  it('a PDF far from every size falls back to its aspect', () => {
    expect(guessReceiptFormat('x.pdf', pdf(50, 97.5))).toBe('dl'); // 1.95
    expect(guessReceiptFormat('x.pdf', pdf(500, 650))).toBe('a5'); // 1.3
  });
  it('a raster uses the nearest aspect, either orientation', () => {
    expect(guessReceiptFormat('x.png', raster(2100, 2850))).toBe('a4');
    expect(guessReceiptFormat('x.png', raster(1950, 1500))).toBe('a5');
    expect(guessReceiptFormat('x.png', raster(1500, 1000))).toBe('a6');
    expect(guessReceiptFormat('x.png', raster(1000, 1950))).toBe('dl');
  });
  it('unusable dimensions: a4', () => {
    const f: ReceiptFormat = guessReceiptFormat('x.png', raster(0, 0));
    expect(f).toBe('a4');
  });
});
