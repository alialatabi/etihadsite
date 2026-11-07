import { describe, expect, it } from 'vitest';
import { computeLayout, deriveLockedSize, layoutParamsFor, maxWidthFor, placementSize } from './index';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { A4_UM, cmToUm, mmToUm } from '@/lib/units';
import type { LayoutParams, LayoutResult, StickerSpec } from '@/lib/types';

const params = (over: Partial<LayoutParams> = {}): LayoutParams => ({
  marginUm: 10_000,
  gapXUm: 0,
  gapYUm: 0,
  allowRotate: false,
  minSideUm: 5_000,
  clip: { kind: 'none' },
  ...over,
});
const rect = (w: number, h: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w, heightUm: h });

/** Margin, gap, integer, ordering and bookkeeping rules every layout must satisfy. */
function assertValid(l: LayoutResult, p: LayoutParams): void {
  expect(l.placements).toHaveLength(l.countPerSheet);
  expect(l.turnedCount).toBe(l.placements.filter((x) => x.turned).length);
  const boxes = l.placements.map((pl) => ({ ...pl, ...placementSize(l, pl) }));
  for (const b of boxes) {
    expect(Number.isInteger(b.xUm) && Number.isInteger(b.yUm)).toBe(true);
    expect(b.xUm).toBeGreaterThanOrEqual(p.marginUm);
    expect(b.yUm).toBeGreaterThanOrEqual(p.marginUm);
    expect(b.xUm + b.widthUm).toBeLessThanOrEqual(A4_UM.widthUm - p.marginUm);
    expect(b.yUm + b.heightUm).toBeLessThanOrEqual(A4_UM.heightUm - p.marginUm);
    expect(b.turned === undefined || b.turned === true).toBe(true);
  }
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1]!;
    const b = boxes[i]!;
    if (!(a.yUm < b.yUm || (a.yUm === b.yUm && a.xUm < b.xUm))) throw new Error(`placements ${i - 1},${i} not row-major`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      // Separated horizontally by >= gapX OR vertically by >= gapY.
      const sepX = a.xUm + a.widthUm + p.gapXUm <= b.xUm || b.xUm + b.widthUm + p.gapXUm <= a.xUm;
      const sepY = a.yUm + a.heightUm + p.gapYUm <= b.yUm || b.yUm + b.heightUm + p.gapYUm <= a.yUm;
      if (!(sepX || sepY)) throw new Error(`cells ${i} and ${j} violate the gap rule`);
    }
  }
  // Block = bounding box of all cells, centred in the usable area (floor of the half-remainder).
  const minX = Math.min(...boxes.map((b) => b.xUm));
  const minY = Math.min(...boxes.map((b) => b.yUm));
  const maxX = Math.max(...boxes.map((b) => b.xUm + b.widthUm));
  const maxY = Math.max(...boxes.map((b) => b.yUm + b.heightUm));
  expect(l.block).toEqual({ xUm: minX, yUm: minY, widthUm: maxX - minX, heightUm: maxY - minY });
  expect(l.block.xUm - l.usable.xUm).toBe(Math.floor((l.usable.widthUm - l.block.widthUm) / 2));
  expect(l.block.yUm - l.usable.yUm).toBe(Math.floor((l.usable.heightUm - l.block.heightUm) / 2));
}

describe('computeLayout', () => {
  it('rotation tie keeps upright', () => {
    const o = computeLayout(rect(50_000, 50_000), params({ allowRotate: true }));
    expect(o.ok && o.layout.rotated).toBe(false);
    // 40x60 vs 60x40 on 190x277: 4*4=16 upright, 3*6=18 rotated -> check equality case instead with a square-ish tie
    const tie = computeLayout(rect(60_000, 60_000), params({ allowRotate: true }));
    expect(tie.ok && tie.layout.rotated).toBe(false);
  });

  it('rotates when strictly better and keeps gaps on page axes', () => {
    // 250x60 cannot stand upright on 190x277; rotated 60x250 -> 3x1; the 27 mm left below holds nothing.
    const o = computeLayout(rect(250_000, 60_000), params({ allowRotate: true, gapXUm: 2_000, gapYUm: 5_000 }));
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const l = o.layout;
    expect(l.rotated).toBe(true);
    expect(l.turnedCount).toBe(0);
    expect(l.cell).toEqual({ widthUm: 60_000, heightUm: 250_000 });
    expect(l.gapXUm).toBe(2_000);
    expect(l.gapYUm).toBe(5_000);
    expect(l.cols).toBe(Math.floor((190_000 + 2_000) / 62_000));
    expect(l.rows).toBe(1);
    expect(l.placements[1]!.xUm - l.placements[0]!.xUm).toBe(62_000);
  });

  it('mixes orientations when that fits strictly more (100x40, gapX 2, gapY 0)', () => {
    const p = params({ allowRotate: true, gapXUm: 2_000, gapYUm: 0 });
    const o = computeLayout(rect(100_000, 40_000), p);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    // Pure grids: upright 1x6 = 6, rotated 4x2 = 8. Mixed beats both.
    expect(o.layout.countPerSheet).toBeGreaterThan(8);
    expect(o.layout.turnedCount).toBeGreaterThan(0);
    assertValid(o.layout, p);
  });

  it('never mixes without allowRotate, nor for squares', () => {
    const a = computeLayout(rect(100_000, 40_000), params({ gapXUm: 2_000, gapYUm: 2_000 }));
    expect(a.ok && a.layout.turnedCount).toBe(0);
    const b = computeLayout(rect(37_000, 37_000), params({ allowRotate: true, gapXUm: 2_000, gapYUm: 2_000 }));
    expect(b.ok && b.layout.turnedCount).toBe(0);
    expect(b.ok && b.layout.placements.some((x) => x.turned)).toBe(false);
  });

  it('every layout obeys margin + gap rules and never loses to a plain grid (sweep)', () => {
    const sizesMm = [
      [100, 40], [50, 30], [70, 50], [90, 55], [60, 45], [85, 54], [40, 25], [30, 20], [15, 10],
      [12, 7], [8, 5], [5, 6], [7, 5.3], [55, 35], [120, 80], [148, 105], [33, 21], [190, 20], [27.5, 61.3],
    ];
    const gaps = [[0, 0], [2_000, 2_000], [2_000, 0], [0, 3_000], [1_500, 4_000]];
    for (const marginUm of [4_000, 7_000, 10_000]) {
      for (const [gx, gy] of gaps) {
        for (const [wm, hm] of sizesMm) {
          const spec = rect(Math.round(wm! * 1000), Math.round(hm! * 1000));
          const p = params({ allowRotate: true, gapXUm: gx, gapYUm: gy, marginUm });
          const o = computeLayout(spec, p);
          const up = computeLayout(spec, { ...p, allowRotate: false });
          const rot = computeLayout(rect(spec.heightUm, spec.widthUm), { ...p, allowRotate: false });
          const grid = Math.max(up.ok ? up.layout.countPerSheet : 0, rot.ok ? rot.layout.countPerSheet : 0);
          if (!o.ok) {
            expect(grid).toBe(0);
            continue;
          }
          expect(o.layout.countPerSheet).toBeGreaterThanOrEqual(grid);
          if (o.layout.countPerSheet === grid) expect(o.layout.turnedCount).toBe(0);
          assertValid(o.layout, p);
        }
      }
    }
  }, 60_000);

  it('is not fooled by float traps (2.3 cm)', () => {
    const w = cmToUm(2.3);
    expect(w).toBe(23_000);
    const o = computeLayout(rect(w, w), params());
    expect(o.ok && o.layout.cols).toBe(8);
    expect(o.ok && o.layout.rows).toBe(12);
    expect(o.ok && o.layout.placements.every((p) => Number.isInteger(p.xUm) && Number.isInteger(p.yUm))).toBe(true);
  });

  it('exact fit works and one µm more fails', () => {
    const ok = computeLayout(rect(190_000, 277_000), params());
    expect(ok.ok && ok.layout.countPerSheet).toBe(1);
    const bad = computeLayout(rect(190_001, 277_000), params());
    expect(bad).toEqual({ ok: false, reason: 'too_big_for_page' });
  });

  it('rotation can rescue a sticker that does not fit upright', () => {
    const spec = rect(250_000, 100_000);
    expect(computeLayout(spec, params())).toEqual({ ok: false, reason: 'too_big_for_page' });
    const o = computeLayout(spec, params({ allowRotate: true }));
    expect(o.ok && o.layout.rotated).toBe(true);
  });

  it('too_small below minSide', () => {
    expect(computeLayout(rect(4_999, 20_000), params())).toEqual({ ok: false, reason: 'too_small' });
    expect(computeLayout(rect(20_000, 4_999), params())).toEqual({ ok: false, reason: 'too_small' });
    expect(computeLayout(rect(5_000, 5_000), params()).ok).toBe(true);
  });

  it('rejects invalid inputs', () => {
    const bad = { ok: false, reason: 'invalid' };
    expect(computeLayout(rect(NaN, 10_000), params())).toEqual(bad);
    expect(computeLayout(rect(10_000, Infinity), params())).toEqual(bad);
    expect(computeLayout(rect(-10_000, 10_000), params())).toEqual(bad);
    expect(computeLayout(rect(0, 10_000), params())).toEqual(bad);
    expect(computeLayout(rect(10_000.5, 10_000), params())).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ gapXUm: -1 }))).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ gapYUm: NaN }))).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ gapXUm: 0.5 }))).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ marginUm: -1 }))).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ marginUm: 105_000 }))).toEqual(bad);
    expect(computeLayout(rect(10_000, 10_000), params({ minSideUm: NaN }))).toEqual(bad);
  });

  it('placements length equals count and block is centred', () => {
    const o = computeLayout(rect(30_000, 30_000), params({ gapXUm: 2_000 }));
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const l = o.layout;
    expect(l.placements).toHaveLength(l.countPerSheet);
    expect(l.block.xUm - l.usable.xUm).toBe(Math.floor((l.usable.widthUm - l.block.widthUm) / 2));
  });
});

describe('layoutParamsFor', () => {
  const s = DEFAULT_SETTINGS.layout;
  it('circle', () => {
    const p = layoutParamsFor({ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }, s);
    expect(p.gapXUm).toBe(s.circleGapXUm);
    expect(p.gapYUm).toBe(s.circleGapYUm);
    expect(p.clip).toEqual({ kind: 'circle' });
  });
  it('rect rounded clamps radius', () => {
    const p = layoutParamsFor({ shape: 'rect', corners: 'rounded', widthUm: 4_000, heightUm: 30_000 }, s);
    expect(p.clip).toEqual({ kind: 'roundedRect', radiusUm: Math.min(s.roundedRadiusUm, 2_000) });
    expect(p.gapXUm).toBe(s.rectRoundedGapUm);
  });
  it('rect sharp and custom', () => {
    expect(layoutParamsFor(rect(20_000, 20_000), s)).toMatchObject({
      gapXUm: s.rectSharpGapUm,
      gapYUm: s.rectSharpGapUm,
      clip: { kind: 'none' },
    });
    expect(layoutParamsFor({ shape: 'custom', widthUm: 20_000, heightUm: 20_000 }, s)).toMatchObject({
      gapXUm: s.customGapUm,
      clip: { kind: 'none' },
    });
  });
});

describe('deriveLockedSize', () => {
  it('circle copies the given side', () => {
    expect(deriveLockedSize('circle', 1.7, { widthUm: 30_000 })).toEqual({ widthUm: 30_000, heightUm: 30_000 });
    expect(deriveLockedSize('circle', 0.3, { heightUm: 25_000 })).toEqual({ widthUm: 25_000, heightUm: 25_000 });
  });
  it('derives the other side, rounded to the nearest µm', () => {
    expect(deriveLockedSize('rect', 2, { widthUm: 40_000 })).toEqual({ widthUm: 40_000, heightUm: 20_000 });
    expect(deriveLockedSize('rect', 2, { heightUm: 20_000 })).toEqual({ widthUm: 40_000, heightUm: 20_000 });
    expect(deriveLockedSize('custom', 3, { widthUm: 10_000 })).toEqual({ widthUm: 10_000, heightUm: 3_333 });
    expect(deriveLockedSize('rect', 3, { widthUm: 10_001 }).heightUm).toBe(3_334);
    expect(deriveLockedSize('rect', 1 / 3, { heightUm: 10_000 }).widthUm).toBe(3_333);
  });
  it('never returns below 1 and tolerates bad aspect', () => {
    expect(deriveLockedSize('rect', 1000, { widthUm: 10 }).heightUm).toBe(1);
    expect(deriveLockedSize('rect', 0.001, { heightUm: 10 }).widthUm).toBe(1);
    expect(deriveLockedSize('rect', NaN, { widthUm: 20_000 })).toEqual({ widthUm: 20_000, heightUm: 20_000 });
    expect(deriveLockedSize('rect', -2, { widthUm: 20_000 }).heightUm).toBe(20_000);
  });
});

describe('maxWidthFor', () => {
  const fitsAt = (aspect: number, w: number, p: LayoutParams): boolean =>
    computeLayout(rect(w, Math.round(w / aspect)), p).ok;

  it('square, no rotation: limited by page width', () => {
    expect(maxWidthFor(1, params())).toBe(190_000);
  });
  it('tall aspect limited by page height', () => {
    expect(maxWidthFor(0.5, params())).toBe(138_500);
  });
  it('wide aspect limited by page width', () => {
    expect(maxWidthFor(2, params())).toBe(190_000);
  });
  it('rotation allows a wider sticker', () => {
    expect(maxWidthFor(2, params({ allowRotate: true }))).toBe(277_000);
  });
  it('result fits and result+1 does not (many aspects)', () => {
    for (const rotate of [false, true]) {
      const p = params({ allowRotate: rotate, gapXUm: 2_000 });
      for (const aspect of [0.1, 0.3, 0.77, 1, 1.333, 1.5, 2.4, 5, 12]) {
        const w = maxWidthFor(aspect, p);
        if (w === 0) continue;
        expect(fitsAt(aspect, w, p)).toBe(true);
        expect(fitsAt(aspect, w + 1, { ...p, minSideUm: 1 })).toBe(false);
      }
    }
  });
  it('returns 0 for extreme ratios (derived side < minSide)', () => {
    expect(maxWidthFor(100, params())).toBe(0);
    expect(maxWidthFor(0.01, params())).toBe(0);
  });
  it('returns 0 for invalid aspect', () => {
    expect(maxWidthFor(0, params())).toBe(0);
    expect(maxWidthFor(NaN, params())).toBe(0);
    expect(maxWidthFor(-1, params())).toBe(0);
  });
  it('respects a larger margin', () => {
    expect(maxWidthFor(1, params({ marginUm: mmToUm(20) }))).toBe(170_000);
  });
});
