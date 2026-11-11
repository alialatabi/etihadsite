import { describe, expect, it } from 'vitest';
import cases from '@/lib/__fixtures__/layout-cases.json';
import { cellSizeFor, computeLayout, layoutParamsFor, maxWidthFor, placementSize } from './index';
import { REG_MARKS, isNearMark, markCentres } from './marks';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { A4_UM } from '@/lib/units';
import type { ClipShape, LayoutOutcome, LayoutParams, LayoutResult, LayoutSettings, Shape, StickerSpec } from '@/lib/types';

const CENTRES = [
  { xUm: 7_000, yUm: 7_000 },
  { xUm: 203_000, yUm: 7_000 },
  { xUm: 7_000, yUm: 290_000 },
  { xUm: 203_000, yUm: 290_000 },
];

const params = (over: Partial<LayoutParams> = {}): LayoutParams => ({
  marginUm: 3_000,
  gapXUm: 0,
  gapYUm: 0,
  allowRotate: false,
  minSideUm: 5_000,
  clip: { kind: 'none' },
  marks: REG_MARKS,
  ...over,
});
const sharp = (w: number, h: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w, heightUm: h });

function layoutOf(o: LayoutOutcome): LayoutResult {
  if (!o.ok) throw new Error(`expected a layout, got ${o.reason}`);
  return o.layout;
}

/** Placements of `l` that stay clear of every dot. */
function clearOfMarks(l: LayoutResult): LayoutResult['placements'] {
  return l.placements.filter((p) => {
    const cell = { xUm: p.xUm, yUm: p.yUm, ...placementSize(l, p) };
    return CENTRES.every((c) => !isNearMark(cell, l.clip, c, REG_MARKS));
  });
}

describe('markCentres / REG_MARKS', () => {
  it('7 mm from both edges, 5 mm wide, 3 mm clearance, TL TR BL BR', () => {
    expect(REG_MARKS).toEqual({ offsetUm: 7_000, diameterUm: 5_000, clearanceUm: 3_000 });
    expect(markCentres(REG_MARKS)).toEqual(CENTRES);
  });
});

describe('isNearMark', () => {
  const tl = CENTRES[0]!;
  const none: ClipShape = { kind: 'none' };
  it('rect: exactly 5.5 mm away is allowed, 1 µm closer is near', () => {
    expect(isNearMark({ xUm: 12_500, yUm: 0, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(false);
    expect(isNearMark({ xUm: 12_499, yUm: 0, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(true);
    expect(isNearMark({ xUm: 0, yUm: 12_500, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(false);
    expect(isNearMark({ xUm: 0, yUm: 12_499, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(true);
    // Diagonal from the page corner: (3 mm, 3 mm) = 4.24 mm is near, (4 mm, 4 mm) = 5.66 mm is not.
    expect(isNearMark({ xUm: 0, yUm: 0, widthUm: 4_000, heightUm: 4_000 }, none, tl, REG_MARKS)).toBe(true);
    expect(isNearMark({ xUm: 0, yUm: 0, widthUm: 3_000, heightUm: 3_000 }, none, tl, REG_MARKS)).toBe(false);
    // Diagonal: (3 mm, 4 mm) from the centre = 5 mm < 5.5 mm.
    expect(isNearMark({ xUm: 10_000, yUm: 11_000, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(true);
    // Diagonal: (4.4 mm, 3.3 mm) = 5.5 mm exactly.
    expect(isNearMark({ xUm: 11_400, yUm: 10_300, widthUm: 10_000, heightUm: 10_000 }, none, tl, REG_MARKS)).toBe(false);
    // A cell containing the dot is near.
    expect(isNearMark({ xUm: 0, yUm: 0, widthUm: 50_000, heightUm: 50_000 }, none, tl, REG_MARKS)).toBe(true);
  });
  it('roundedRect counts as the whole cell rectangle', () => {
    expect(isNearMark({ xUm: 12_499, yUm: 0, widthUm: 10_000, heightUm: 10_000 }, { kind: 'roundedRect', radiusUm: 3_000 }, tl, REG_MARKS)).toBe(true);
  });
  it('circle clip uses the inscribed circle, not the box', () => {
    // A 58 mm cell at (3.5, 3.5) mm: its box corner is 4.95 mm from the dot, its circle about 7.06 mm.
    const cell = { xUm: 3_500, yUm: 3_500, widthUm: 58_000, heightUm: 58_000 };
    expect(isNearMark(cell, { kind: 'none' }, tl, REG_MARKS)).toBe(true);
    expect(isNearMark(cell, { kind: 'circle' }, tl, REG_MARKS)).toBe(false);
    // Circle edge exactly 5.5 mm from the centre (on the horizontal line through the dot): allowed.
    expect(isNearMark({ xUm: 12_500, yUm: 2_000, widthUm: 10_000, heightUm: 10_000 }, { kind: 'circle' }, tl, REG_MARKS)).toBe(false);
    expect(isNearMark({ xUm: 12_499, yUm: 2_000, widthUm: 10_000, heightUm: 10_000 }, { kind: 'circle' }, tl, REG_MARKS)).toBe(true);
    // Non-square cell: the inscribed circle has the shorter side as diameter.
    expect(isNearMark({ xUm: 12_500, yUm: -3_000, widthUm: 10_000, heightUm: 20_000 }, { kind: 'circle' }, tl, REG_MARKS)).toBe(false);
  });
  it('odd diameter is exact (doubled coordinates)', () => {
    const m = { offsetUm: 7_000, diameterUm: 5_001, clearanceUm: 3_000 }; // keep-out 5 500.5 µm
    expect(isNearMark({ xUm: 12_500, yUm: 0, widthUm: 1_000, heightUm: 10_000 }, none, tl, m)).toBe(true);
    expect(isNearMark({ xUm: 12_501, yUm: 0, widthUm: 1_000, heightUm: 10_000 }, none, tl, m)).toBe(false);
  });
});

describe('computeLayout with marks', () => {
  it('reproduces example.pdf: 15 circles of 5.8 cm at 3 mm margin', () => {
    const l = layoutOf(
      computeLayout({ shape: 'circle', widthUm: 58_000, heightUm: 58_000 }, params({ gapXUm: 2_000, clip: { kind: 'circle' } })),
    );
    expect(l.countPerSheet).toBe(15);
    expect(l.removedNearMarks).toBe(0);
    expect(l.marks).toEqual({ diameterUm: 5_000, centres: CENTRES });
    const xs = [16_000, 76_000, 136_000];
    expect(l.placements).toEqual([0, 1, 2, 3, 4].flatMap((k) => xs.map((x) => ({ xUm: x, yUm: 3_500 + 58_000 * k }))));
    expect(l.usable).toEqual({ xUm: 3_000, yUm: 3_000, widthUm: 204_000, heightUm: 291_000 });
  });

  it('sharp 51 x 58 mm: area 3 (4 x 4, no holes) wins the tie against area 1 (20 - 4)', () => {
    const l = layoutOf(computeLayout(sharp(51_000, 58_000), params()));
    expect(l.countPerSheet).toBe(16);
    expect(l.removedNearMarks).toBe(0);
    expect(l.cols).toBe(4);
    expect(l.rows).toBe(4);
    expect(l.placements.every((p) => p.yUm >= 12_500)).toBe(true);
    expect(l.placements[0]).toEqual({ xUm: 3_000, yUm: 32_500 });
    expect(l.usable).toEqual({ xUm: 3_000, yUm: 3_000, widthUm: 204_000, heightUm: 291_000 });
    expect(Object.keys(l).slice(-2)).toEqual(['marks', 'removedNearMarks']);
  });

  it('keeps area 1 with holes when that fits more (circle 1 cm)', () => {
    const circle: StickerSpec = { shape: 'circle', widthUm: 10_000, heightUm: 10_000 };
    const l = layoutOf(computeLayout(circle, params({ gapXUm: 2_000, clip: { kind: 'circle' } })));
    const plain = layoutOf(computeLayout(circle, params({ gapXUm: 2_000, clip: { kind: 'circle' }, marks: undefined })));
    expect(l.removedNearMarks).toBeGreaterThan(0);
    expect(l.countPerSheet).toBe(plain.countPerSheet - l.removedNearMarks!);
    expect(l.block).toEqual(plain.block);
    expect(clearOfMarks(l)).toHaveLength(l.countPerSheet);
  });

  it('chooses the orientation after removal (sharp 21 x 39 mm, rotation on)', () => {
    const spec = sharp(21_000, 39_000);
    const p = params({ allowRotate: true });
    const l = layoutOf(computeLayout(spec, p));
    const plain = { ...p, allowRotate: false, marks: undefined };
    const up = layoutOf(computeLayout(spec, plain));
    const rot = layoutOf(computeLayout(sharp(39_000, 21_000), plain));
    expect(l.countPerSheet).toBeGreaterThanOrEqual(clearOfMarks(up).length);
    expect(l.countPerSheet).toBeGreaterThanOrEqual(clearOfMarks(rot).length);
  });

  it('mixed layout with removed cells recounts turnedCount and countPerSheet', () => {
    const p = params({ allowRotate: true });
    const l = layoutOf(computeLayout(sharp(10_000, 21_000), p));
    expect(l.removedNearMarks).toBeGreaterThan(0);
    expect(l.turnedCount).toBeGreaterThan(0);
    expect(l.turnedCount).toBe(l.placements.filter((x) => x.turned).length);
    expect(l.countPerSheet).toBe(l.placements.length);
    expect(clearOfMarks(l)).toHaveLength(l.countPerSheet);
  });

  it('a smaller margin never fits fewer: every golden size, rotation on and off, 3 mm vs 7 mm', () => {
    // The dots do not move with the margin, so an arrangement that is valid at 7 mm is valid at 3 mm.
    // Area 1 picking a plain grid that never touches a dot must not hide a better inset area.
    const RECT = [10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000, 70_000, 100_000, 150_000, 200_000, 250_000];
    const CUSTOM = [5_000, 8_500, 12_300, 21_000, 33_300, 47_000, 64_500, 99_000, 140_000, 196_000, 283_000];
    const CIRCLE = [
      1_000, 4_000, 4_999, 5_000, 7_500, 10_000, 12_500, 15_000, 20_000, 23_000, 25_000, 30_000, 35_000, 40_000, 45_000,
      50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 120_000, 150_000, 196_000, 196_001, 210_000, 300_000,
    ];
    const specs: StickerSpec[] = [
      ...CIRCLE.map((d): StickerSpec => ({ shape: 'circle', widthUm: d, heightUm: d })),
      ...(['rounded', 'sharp'] as const).flatMap((corners) =>
        RECT.flatMap((w) => RECT.map((h): StickerSpec => ({ shape: 'rect', corners, widthUm: w, heightUm: h }))),
      ),
      ...CUSTOM.flatMap((w) => CUSTOM.map((h): StickerSpec => ({ shape: 'custom', widthUm: w, heightUm: h }))),
    ];
    const countAt = (spec: StickerSpec, marginUm: number, allowRotate = true): number => {
      const o = computeLayout(spec, layoutParamsFor(spec, { ...DEFAULT_SETTINGS.layout, allowRotate, marginUm }));
      return o.ok ? o.layout.countPerSheet : 0;
    };
    for (const rot of [true, false]) {
      const lower = specs
        .map((s) => ({
          s: `${s.shape}/${s.corners ?? '-'} ${s.widthUm}x${s.heightUm} rotate=${rot}`,
          at3: countAt(s, 3_000, rot),
          at7: countAt(s, 7_000, rot),
        }))
        .filter((r) => r.at3 < r.at7);
      expect(lower).toEqual([]);
    }
    expect(countAt(sharp(70_000, 100_000), 3_000)).toBeGreaterThanOrEqual(6);
    expect(countAt(sharp(100_000, 70_000), 3_000)).toBeGreaterThanOrEqual(6);
    expect(countAt(sharp(100_000, 40_000), 3_000)).toBeGreaterThanOrEqual(12);
    expect(countAt(sharp(40_000, 100_000), 3_000)).toBeGreaterThanOrEqual(12);
  }, 120_000);

  it('invalid marks are rejected; too big everywhere is too_big_for_page', () => {
    const bad = { ok: false, reason: 'invalid' };
    expect(computeLayout(sharp(30_000, 30_000), params({ marks: { ...REG_MARKS, diameterUm: 0 } }))).toEqual(bad);
    expect(computeLayout(sharp(30_000, 30_000), params({ marks: { ...REG_MARKS, offsetUm: -1 } }))).toEqual(bad);
    expect(computeLayout(sharp(30_000, 30_000), params({ marks: { ...REG_MARKS, clearanceUm: 0.5 } }))).toEqual(bad);
    // Full usable area: every candidate cell covers a dot.
    expect(computeLayout(sharp(204_000, 291_000), params())).toEqual({ ok: false, reason: 'too_big_for_page' });
    // Full width but clear of the dots in height (272 mm), and full height at 185 mm wide.
    expect(layoutOf(computeLayout(sharp(204_000, 272_000), params())).countPerSheet).toBe(1);
    expect(layoutOf(computeLayout(sharp(185_000, 291_000), params())).countPerSheet).toBe(1);
  });

  it('without marks the result has no marks keys (every fixture)', () => {
    for (const c of cases) {
      const o = computeLayout(c.spec as StickerSpec, c.params as LayoutParams);
      if (!o.ok) continue;
      expect('marks' in o.layout).toBe(false);
      expect('removedNearMarks' in o.layout).toBe(false);
    }
  });

  it('layoutParamsFor always adds the dots', () => {
    for (const shape of ['circle', 'rect', 'custom'] as Shape[]) {
      expect(layoutParamsFor({ shape, widthUm: 20_000, heightUm: 20_000 }, DEFAULT_SETTINGS.layout).marks).toEqual(REG_MARKS);
    }
  });
});

/** Deterministic LCG so the property test sees the same cases on every run. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('property: layouts with marks', () => {
  it('inside the margin, clear of every dot, no overlap, gaps kept (420 cases)', () => {
    const rnd = lcg(20261112);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const shapes: StickerSpec['shape'][] = ['circle', 'rect', 'rect', 'custom'];
    let checked = 0;
    for (let i = 0; i < 420; i++) {
      const settings: LayoutSettings = {
        ...DEFAULT_SETTINGS.layout,
        marginUm: pick([0, 3_000, 4_000, 7_000]),
        allowRotate: rnd() < 0.5,
        circleGapXUm: pick([0, 2_000]),
        circleGapYUm: pick([0, 1_000]),
        rectRoundedGapUm: pick([0, 2_000]),
        rectSharpGapUm: pick([0, 1_500]),
        customGapUm: pick([0, 2_000, 3_000]),
      };
      const shape = pick(shapes);
      const w = 5_000 + Math.floor(rnd() * 145_001);
      const h = shape === 'circle' ? w : 5_000 + Math.floor(rnd() * 145_001);
      const spec: StickerSpec = shape === 'rect' ? { shape, corners: rnd() < 0.5 ? 'sharp' : 'rounded', widthUm: w, heightUm: h } : { shape, widthUm: w, heightUm: h };
      const p = layoutParamsFor(spec, settings);
      const o = computeLayout(spec, p);
      if (!o.ok) {
        expect(o.reason).toBe('too_big_for_page');
        continue;
      }
      checked++;
      const l = o.layout;
      expect(l.countPerSheet).toBe(l.placements.length);
      expect(l.turnedCount).toBe(l.placements.filter((x) => x.turned).length);
      expect(l.marks).toEqual({ diameterUm: 5_000, centres: CENTRES });
      const boxes = l.placements.map((pl) => ({ ...pl, ...cellSizeFor(l, Boolean(pl.turned)) }));
      for (const b of boxes) {
        expect(b.xUm).toBeGreaterThanOrEqual(p.marginUm);
        expect(b.yUm).toBeGreaterThanOrEqual(p.marginUm);
        expect(b.xUm + b.widthUm).toBeLessThanOrEqual(A4_UM.widthUm - p.marginUm);
        expect(b.yUm + b.heightUm).toBeLessThanOrEqual(A4_UM.heightUm - p.marginUm);
        for (const c of CENTRES) expect(isNearMark(b, l.clip, c, REG_MARKS)).toBe(false);
      }
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const A = boxes[a]!;
          const B = boxes[b]!;
          const sepX = A.xUm + A.widthUm + p.gapXUm <= B.xUm || B.xUm + B.widthUm + p.gapXUm <= A.xUm;
          const sepY = A.yUm + A.heightUm + p.gapYUm <= B.yUm || B.yUm + B.heightUm + p.gapYUm <= A.yUm;
          if (!(sepX || sepY)) throw new Error(`case ${i}: cells ${a} and ${b} overlap or break the gap rule`);
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  }, 120_000);
});

describe('maxWidthFor with marks', () => {
  /** Reference: the 1 µm walk maxWidthFor used before (copied from the pre-marks code). */
  function maxWidthWalk(aspect: number, params: LayoutParams): number {
    if (!Number.isFinite(aspect) || aspect <= 0) return 0;
    const usableW = A4_UM.widthUm - 2 * params.marginUm;
    const usableH = A4_UM.heightUm - 2 * params.marginUm;
    if (!(usableW > 0 && usableH > 0)) return 0;
    const heightOf = (w: number): number => Math.max(1, Math.round(w / aspect));
    const spec = (w: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w, heightUm: heightOf(w) });
    const loose: LayoutParams = { ...params, minSideUm: 1 };
    const fits = (w: number): boolean => computeLayout(spec(w), { ...loose, allowRotate: false }).ok ||
      (params.allowRotate && computeLayout({ ...spec(w), widthUm: heightOf(w), heightUm: w }, { ...loose, allowRotate: false }).ok);
    const upright = Math.min(usableW, usableH * aspect);
    const turned = params.allowRotate ? Math.min(usableH, usableW * aspect) : 0;
    let w = Math.floor(Math.max(upright, turned));
    if (!Number.isFinite(w) || w < 1) w = 1;
    while (w > 1 && !fits(w)) w--;
    while (fits(w + 1)) w++;
    if (!fits(w)) return 0;
    return w >= params.minSideUm && computeLayout(spec(w), params).ok ? w : 0;
  }

  it('same answer as the 1 µm walk, at most 300 layout runs', () => {
    const clips: ClipShape[] = [{ kind: 'none' }, { kind: 'circle' }];
    for (const aspect of [0.3, 0.7, 0.70, 0.7071, 1, 1.43, 3]) {
      for (const allowRotate of [false, true]) {
        for (const marks of [REG_MARKS, undefined]) {
          for (const clip of clips) {
            const p = params({ allowRotate, marks, clip, gapXUm: 2_000 });
            let runs = 0;
            const counted: typeof computeLayout = (s, q) => {
              runs++;
              return computeLayout(s, q);
            };
            const fast = maxWidthFor(aspect, p, counted);
            expect({ aspect, allowRotate, marks: !!marks, clip: clip.kind, w: fast }).toEqual({
              aspect,
              allowRotate,
              marks: !!marks,
              clip: clip.kind,
              w: maxWidthWalk(aspect, p),
            });
            expect(runs).toBeLessThanOrEqual(300);
          }
        }
      }
    }
  }, 120_000);

  it('aspect 0.70 with dots stops at the dot zones (well below the 203.7 mm estimate)', () => {
    const w = maxWidthFor(0.7, params({ allowRotate: true }));
    expect(w).toBeGreaterThan(185_000);
    expect(w).toBeLessThan(195_000);
  });
});
