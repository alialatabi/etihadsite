/**
 * GOLDEN — layout engine (src/lib/layout/index.ts + pack.ts) and the /how-it-works examples.
 * One line per case: outcome, grid, count, orientation, cell, gaps, block, clip and two
 * hashes (placements only / whole LayoutResult, canonical JSON).
 */
import { describe, expect, it } from 'vitest';
import { computeExamples, illustrationLayout } from '@/app/how-it-works/examples';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeLayout, deriveLockedSize, layoutParamsFor, maxWidthFor, placementRotated, placementSize } from '@/lib/layout';
import { DP_WORK_LIMIT, FIVE_BLOCK_STATE_LIMIT, packMixed, packTwoLevel, rasterPoints, type Box, type PackResult } from '@/lib/layout/pack';
import type { ClipShape, LayoutOutcome, LayoutParams, LayoutSettings, Shape, StickerSpec } from '@/lib/types';
import { canon, sha16, sha256, show } from './_util';

const D = DEFAULT_SETTINGS.layout;

/** Settings variants every grid is run against. */
const VARIANTS: Record<string, LayoutSettings> = {
  default: D,
  'default+rotate': { ...D, allowRotate: true },
  'margin10-altGaps': {
    marginUm: 10_000,
    circleGapXUm: 0,
    circleGapYUm: 2_000,
    rectRoundedGapUm: 3_000,
    rectSharpGapUm: 1_000,
    customGapUm: 0,
    roundedRadiusUm: 5_000,
    allowRotate: false,
    minSideUm: 5_000,
  },
  'margin0-noGaps+rotate': {
    marginUm: 0,
    circleGapXUm: 0,
    circleGapYUm: 0,
    rectRoundedGapUm: 0,
    rectSharpGapUm: 0,
    customGapUm: 0,
    roundedRadiusUm: 0,
    allowRotate: true,
    minSideUm: 10_000,
  },
  'margin5-wideGaps+rotate': {
    marginUm: 5_000,
    circleGapXUm: 1_000,
    circleGapYUm: 3_000,
    rectRoundedGapUm: 1_000,
    rectSharpGapUm: 2_000,
    customGapUm: 4_000,
    roundedRadiusUm: 100_000,
    allowRotate: true,
    minSideUm: 20_000,
  },
};

const clipText = (c: ClipShape): string => (c.kind === 'roundedRect' ? `roundedRect:${c.radiusUm}` : c.kind);

function outcomeLine(label: string, out: LayoutOutcome): string {
  if (!out.ok) return `${label} -> FAIL ${out.reason}`;
  const L = out.layout;
  return (
    `${label} -> ok n=${L.countPerSheet} grid=${L.cols}x${L.rows} rot=${L.rotated ? 1 : 0} turned=${L.turnedCount}` +
    ` cell=${L.cell.widthUm}x${L.cell.heightUm} gap=${L.gapXUm},${L.gapYUm}` +
    ` block=${L.block.xUm},${L.block.yUm},${L.block.widthUm}x${L.block.heightUm} clip=${clipText(L.clip)}` +
    ` placements=${L.placements.length}:${sha16(canon(L.placements))} layout=${sha16(canon(L))}`
  );
}

const mm = (um: number): string => String(um / 1000);

function specLabel(s: StickerSpec): string {
  const kind = s.shape === 'rect' ? `rect/${s.corners ?? '-'}` : s.shape;
  return `${kind} ${mm(s.widthUm)}x${mm(s.heightUm)}mm`;
}

function runGrid(specs: StickerSpec[], settings: LayoutSettings): { lines: string[]; digest: string } {
  const lines: string[] = [];
  const full: unknown[] = [];
  for (const spec of specs) {
    const out = computeLayout(spec, layoutParamsFor(spec, settings));
    lines.push(outcomeLine(specLabel(spec), out));
    full.push(out);
  }
  return { lines, digest: sha256(canon(full)) };
}

/* ───────────────────────── input grids ───────────────────────── */

// 27 diameters: below the minimum, around every interesting boundary, up to larger than the page.
const CIRCLE_DIAMETERS_UM = [
  1_000, 4_000, 4_999, 5_000, 7_500, 10_000, 12_500, 15_000, 20_000, 23_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000,
  60_000, 70_000, 80_000, 90_000, 100_000, 120_000, 150_000, 196_000, 196_001, 210_000, 300_000,
];
const circles: StickerSpec[] = CIRCLE_DIAMETERS_UM.map((d) => ({ shape: 'circle', widthUm: d, heightUm: d }));

// 12 x 12 = 144 sizes from 10 mm to 250 mm, for both corner styles.
const RECT_SIDES_UM = [10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000, 70_000, 100_000, 150_000, 200_000, 250_000];
const rects = (corners: 'rounded' | 'sharp'): StickerSpec[] =>
  RECT_SIDES_UM.flatMap((w) => RECT_SIDES_UM.map((h): StickerSpec => ({ shape: 'rect', corners, widthUm: w, heightUm: h })));

// Custom shapes: deliberately non-round sizes (aspect-locked sizes are rarely round), 11 x 11 = 121.
const CUSTOM_SIDES_UM = [5_000, 8_500, 12_300, 21_000, 33_300, 47_000, 64_500, 99_000, 140_000, 196_000, 283_000];
const customs: StickerSpec[] = CUSTOM_SIDES_UM.flatMap((w) =>
  CUSTOM_SIDES_UM.map((h): StickerSpec => ({ shape: 'custom', widthUm: w, heightUm: h })),
);

describe('golden: computeLayout(spec, layoutParamsFor(spec, settings))', () => {
  for (const [name, settings] of Object.entries(VARIANTS)) {
    describe(`settings: ${name}`, () => {
      it('circles', () => {
        expect(runGrid(circles, settings)).toMatchSnapshot();
      });
      it('rect rounded 12x12', () => {
        expect(runGrid(rects('rounded'), settings)).toMatchSnapshot();
      });
      it('rect sharp 12x12', () => {
        expect(runGrid(rects('sharp'), settings)).toMatchSnapshot();
      });
      it('custom 11x11', () => {
        expect(runGrid(customs, settings)).toMatchSnapshot();
      });
    });
  }

  it('small odd sizes with rotation (two-level fallback and heavy DP region)', () => {
    const settings: LayoutSettings = { ...D, allowRotate: true };
    const sizes: [number, number][] = [
      [5_300, 7_100],
      [6_100, 8_700],
      [5_000, 12_300],
      [7_300, 9_100],
      [9_900, 12_700],
      [11_100, 13_300],
      [12_700, 17_300],
      [14_200, 21_000],
      [18_500, 26_500],
      [29_700, 42_000],
      [42_420, 30_000],
      [52_000, 74_000],
      [85_600, 53_980],
      [105_000, 148_500],
    ];
    const specs = sizes.flatMap(([w, h]): StickerSpec[] => [
      { shape: 'rect', corners: 'sharp', widthUm: w, heightUm: h },
      { shape: 'rect', corners: 'rounded', widthUm: w, heightUm: h },
      { shape: 'custom', widthUm: h, heightUm: w },
    ]);
    expect(runGrid(specs, settings)).toMatchSnapshot();
  });

  it('whole LayoutResult objects for a few representative cases', () => {
    const cases: [StickerSpec, LayoutSettings][] = [
      [{ shape: 'circle', widthUm: 30_000, heightUm: 30_000 }, D],
      [{ shape: 'rect', corners: 'rounded', widthUm: 100_000, heightUm: 60_000 }, D],
      [{ shape: 'rect', corners: 'sharp', widthUm: 200_000, heightUm: 50_000 }, { ...D, allowRotate: true }],
      [{ shape: 'rect', corners: 'rounded', widthUm: 100_000, heightUm: 40_000 }, { ...D, allowRotate: true }],
      [{ shape: 'custom', widthUm: 196_000, heightUm: 283_000 }, D],
    ];
    expect(cases.map(([spec, settings]) => ({ spec, out: computeLayout(spec, layoutParamsFor(spec, settings)) }))).toMatchSnapshot();
  });
});

describe('golden: computeLayout with raw params (validation and boundaries)', () => {
  const base: LayoutParams = { marginUm: 7_000, gapXUm: 2_000, gapYUm: 0, allowRotate: false, minSideUm: 5_000, clip: { kind: 'none' } };
  const rect = (w: unknown, h: unknown): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w as number, heightUm: h as number });
  const table: [string, StickerSpec, LayoutParams][] = [
    ['width 0', rect(0, 30_000), base],
    ['width -1', rect(-1, 30_000), base],
    ['width 1.5', rect(1.5, 30_000), base],
    ['width NaN', rect(Number.NaN, 30_000), base],
    ['width Infinity', rect(Number.POSITIVE_INFINITY, 30_000), base],
    ['width string', rect('30000', 30_000), base],
    ['height null', rect(30_000, null), base],
    ['height undefined', rect(30_000, undefined), base],
    ['height 30000.5', rect(30_000, 30_000.5), base],
    ['minSide 0', rect(30_000, 30_000), { ...base, minSideUm: 0 }],
    ['minSide 1.5', rect(30_000, 30_000), { ...base, minSideUm: 1.5 }],
    ['gapX -1', rect(30_000, 30_000), { ...base, gapXUm: -1 }],
    ['gapY 0.5', rect(30_000, 30_000), { ...base, gapYUm: 0.5 }],
    ['margin -1', rect(30_000, 30_000), { ...base, marginUm: -1 }],
    ['margin 105000 (2x = page width)', rect(30_000, 30_000), { ...base, marginUm: 105_000 }],
    ['margin 104999 (usable width 2um)', rect(30_000, 30_000), { ...base, marginUm: 104_999 }],
    ['margin 104999, 1x1um sticker, minSide 1', rect(1, 1), { ...base, marginUm: 104_999, minSideUm: 1, gapXUm: 0 }],
    ['width = minSide - 1', rect(4_999, 30_000), base],
    ['height = minSide - 1', rect(30_000, 4_999), base],
    ['both = minSide', rect(5_000, 5_000), base],
    ['exact usable width', rect(196_000, 283_000), base],
    ['usable width + 1', rect(196_001, 283_000), base],
    ['usable height + 1', rect(196_000, 283_001), base],
    ['usable height + 1, rotate allowed', rect(196_000, 283_001), { ...base, allowRotate: true }],
    ['283x196 upright impossible', rect(283_000, 196_000), base],
    ['283x196 rotate allowed', rect(283_000, 196_000), { ...base, allowRotate: true }],
    ['two columns exactly (97x50, gapX 2)', rect(97_000, 50_000), base],
    ['two columns + 1um', rect(97_001, 50_000), base],
    ['rotate tie -> upright (60x60)', rect(60_000, 60_000), { ...base, allowRotate: true }],
    ['rotate tie -> upright (98x141.5 gap 0)', rect(98_000, 141_500), { ...base, gapXUm: 0, allowRotate: true }],
    ['rotated beats upright (120x90)', rect(120_000, 90_000), { ...base, allowRotate: true }],
    ['mixed beats both (100x40 gap 2/2)', rect(100_000, 40_000), { ...base, gapYUm: 2_000, allowRotate: true }],
    ['circle spec with w != h', { shape: 'circle', widthUm: 30_000, heightUm: 40_000 }, { ...base, clip: { kind: 'circle' } }],
    ['huge gaps (50 mm)', rect(30_000, 30_000), { ...base, gapXUm: 50_000, gapYUm: 50_000 }],
    ['gap larger than usable', rect(30_000, 30_000), { ...base, gapXUm: 500_000, gapYUm: 500_000 }],
    ['clip passes through untouched', rect(30_000, 30_000), { ...base, clip: { kind: 'roundedRect', radiusUm: 123 } }],
  ];
  it('table', () => {
    expect(table.map(([label, spec, params]) => outcomeLine(label, computeLayout(spec, params)))).toMatchSnapshot();
  });
});

describe('golden: layoutParamsFor', () => {
  it('every shape x settings variant, radius clamp, defaults for unknown values', () => {
    const specs: StickerSpec[] = [
      { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
      { shape: 'circle', corners: 'sharp', widthUm: 30_000, heightUm: 30_000 },
      { shape: 'rect', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'rect', corners: 'sharp', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'rect', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'rect', corners: 'rounded', widthUm: 4_000, heightUm: 60_000 },
      { shape: 'rect', corners: 'rounded', widthUm: 60_000, heightUm: 5_001 },
      { shape: 'rect', corners: 'rounded', widthUm: 1, heightUm: 1 },
      { shape: 'custom', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'custom', corners: 'rounded', widthUm: 50_000, heightUm: 30_000 },
      { shape: 'hexagon' as Shape, widthUm: 50_000, heightUm: 30_000 },
    ];
    const rows: string[] = [];
    for (const [name, settings] of Object.entries(VARIANTS)) {
      for (const spec of specs) rows.push(`${name} | ${specLabel(spec)} -> ${canon(layoutParamsFor(spec, settings))}`);
    }
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: maxWidthFor', () => {
  const ASPECTS = [
    0.02, 0.05, 0.1, 0.25, 0.5, 2 / 3, 0.7071, 196 / 283, 1, 1.25, 1.4142, 1.5, 283 / 196, 2, 3, 4, 10, 30, 39.2, 39.3, 60, 0, -1,
    Number.NaN, Number.POSITIVE_INFINITY,
  ];
  const SHAPES: StickerSpec[] = [
    { shape: 'circle', widthUm: 1, heightUm: 1 },
    { shape: 'rect', corners: 'rounded', widthUm: 1, heightUm: 1 },
    { shape: 'rect', corners: 'sharp', widthUm: 1, heightUm: 1 },
    { shape: 'custom', widthUm: 1, heightUm: 1 },
  ];
  it('aspects x shapes x settings variants', () => {
    const rows: string[] = [];
    for (const [name, settings] of Object.entries(VARIANTS)) {
      for (const spec of SHAPES) {
        const params = layoutParamsFor(spec, settings);
        const values = ASPECTS.map((a) => `${Number.isFinite(a) ? Number(a.toFixed(4)) : String(a)}=>${maxWidthFor(a, params)}`);
        rows.push(`${name} | ${spec.shape}${spec.corners ? '/' + spec.corners : ''} | ${values.join(' ')}`);
      }
    }
    expect(rows).toMatchSnapshot();
  });
  it('degenerate params', () => {
    const p: LayoutParams = { marginUm: 7_000, gapXUm: 0, gapYUm: 0, allowRotate: false, minSideUm: 5_000, clip: { kind: 'none' } };
    expect({
      marginHalfPage: maxWidthFor(1, { ...p, marginUm: 105_000 }),
      marginHuge: maxWidthFor(1, { ...p, marginUm: 500_000 }),
      minSideHuge: maxWidthFor(1, { ...p, minSideUm: 250_000 }),
      minSideEqualsMax: maxWidthFor(1, { ...p, minSideUm: 196_000 }),
      minSideJustAboveMax: maxWidthFor(1, { ...p, minSideUm: 196_001 }),
      rotateWide: maxWidthFor(1.4142, { ...p, allowRotate: true }),
      noRotateWide: maxWidthFor(1.4142, p),
    }).toMatchSnapshot();
  });
});

describe('golden: deriveLockedSize', () => {
  it('table', () => {
    const shapes: Shape[] = ['circle', 'rect', 'custom'];
    const aspects = [1, 1.5, 2 / 3, 0.7071, 3, 0.001, 1000, 0, -2, Number.NaN, Number.POSITIVE_INFINITY];
    const givens: ({ widthUm: number } | { heightUm: number })[] = [
      { widthUm: 30_000 },
      { heightUm: 30_000 },
      { widthUm: 42_420 },
      { heightUm: 42_420 },
      { widthUm: 1 },
      { heightUm: 1 },
      { widthUm: 0 },
      { heightUm: -5 },
      { widthUm: 12_345.6 },
      { heightUm: 0.4 },
      { widthUm: Number.NaN },
      { heightUm: Number.POSITIVE_INFINITY },
    ];
    const rows: string[] = [];
    for (const shape of shapes) {
      for (const aspect of aspects) {
        const cells = givens.map((g) => {
          const r = deriveLockedSize(shape, aspect, g);
          return `${'widthUm' in g ? 'w' : 'h'}=${show('widthUm' in g ? g.widthUm : g.heightUm)}=>${r.widthUm}x${r.heightUm}`;
        });
        rows.push(`${shape} aspect=${show(Number.isFinite(aspect) ? Number(aspect.toFixed(4)) : aspect)} | ${cells.join(' ')}`);
      }
    }
    expect(rows).toMatchSnapshot();
  });
});

describe('golden: placementSize / placementRotated', () => {
  it('per-placement size and art rotation for uniform, rotated and mixed layouts', () => {
    const cases: [string, StickerSpec, LayoutSettings][] = [
      ['uniform upright', { shape: 'rect', corners: 'sharp', widthUm: 50_000, heightUm: 30_000 }, D],
      ['uniform rotated', { shape: 'rect', corners: 'sharp', widthUm: 200_000, heightUm: 50_000 }, { ...D, allowRotate: true }],
      ['mixed 100x40', { shape: 'rect', corners: 'rounded', widthUm: 100_000, heightUm: 40_000 }, { ...D, allowRotate: true }],
      ['mixed 70x50', { shape: 'rect', corners: 'sharp', widthUm: 70_000, heightUm: 50_000 }, { ...D, allowRotate: true }],
      ['mixed 30x42.42', { shape: 'custom', widthUm: 30_000, heightUm: 42_420 }, { ...D, allowRotate: true }],
    ];
    const out = cases.map(([label, spec, settings]) => {
      const r = computeLayout(spec, layoutParamsFor(spec, settings));
      if (!r.ok) return { label, fail: r.reason };
      const L = r.layout;
      return {
        label,
        rotated: L.rotated,
        turnedCount: L.turnedCount,
        cell: `${L.cell.widthUm}x${L.cell.heightUm}`,
        placements: L.placements.map((p) => {
          const s = placementSize(L, p);
          return `${p.xUm},${p.yUm} ${p.turned ? 'turned' : 'main'} size=${s.widthUm}x${s.heightUm} artRotated=${placementRotated(L, p)}`;
        }),
      };
    });
    expect(out).toMatchSnapshot();
  });
});

describe('golden: pack.ts', () => {
  const describePack = (r: PackResult | null) => {
    if (!r) return null;
    const sorted = [...r.cells].sort((p, q) => p.y - q.y || p.x - q.x || p.o - q.o);
    return {
      count: r.count,
      main: r.main,
      cells: r.cells.length,
      upright: r.cells.filter((c) => c.o === 0).length,
      turned: r.cells.filter((c) => c.o === 1).length,
      emittedOrderHash: sha16(canon(r.cells)),
      sortedHash: sha16(canon(sorted)),
    };
  };
  const box = (w: number, h: number): Box => ({ w, h });
  /** [label, W, H, a, b] — W/H/a/b are INFLATED sizes, as the layout engine passes them. */
  const INPUTS: [string, number, number, Box, Box][] = [
    ['tiny 10x10, 3x4', 10, 10, box(3, 4), box(4, 3)],
    ['tiny 7x5, 3x2', 7, 5, box(3, 2), box(2, 3)],
    ['pinwheel 5x5, 2x3', 5, 5, box(2, 3), box(3, 2)],
    ['pinwheel 13x13, 3x5', 13, 13, box(3, 5), box(5, 3)],
    ['nothing fits', 10, 10, box(11, 3), box(3, 11)],
    ['only turned fits', 10, 4, box(3, 9), box(9, 3)],
    ['exact single', 9, 3, box(9, 3), box(3, 9)],
    ['square boxes', 20, 20, box(6, 6), box(6, 6)],
    ['zero-size container', 0, 0, box(3, 4), box(4, 3)],
    ['100x40 +2 gap on default sheet', 198_000, 283_000, box(102_000, 42_000), box(42_000, 102_000)],
    ['70x50 sharp on default sheet', 196_000, 283_000, box(70_000, 50_000), box(50_000, 70_000)],
    ['85.6x53.98 +2 gap', 198_000, 285_000, box(87_600, 55_980), box(55_980, 87_600)],
    ['30x42.42 +2 gap', 198_000, 285_000, box(32_000, 44_420), box(44_420, 32_000)],
    ['14.2x21 +2 gap', 198_000, 285_000, box(16_200, 23_000), box(23_000, 16_200)],
    ['5.3x7.1 +2 gap (over DP_WORK_LIMIT)', 198_000, 285_000, box(7_300, 9_100), box(9_100, 7_300)],
    ['6.1x8.7 +2 gap (over DP_WORK_LIMIT)', 198_000, 285_000, box(8_100, 10_700), box(10_700, 8_100)],
    ['A6 on A4, no gap', 210_000, 297_000, box(105_000, 148_500), box(148_500, 105_000)],
  ];

  it('constants', () => {
    expect({ DP_WORK_LIMIT, FIVE_BLOCK_STATE_LIMIT }).toMatchSnapshot();
  });

  it('packMixed samples', () => {
    expect(
      INPUTS.map(([label, W, H, a, b]) => {
        const nx = rasterPoints(W, a.w, b.w).length;
        const ny = rasterPoints(H, a.h, b.h).length;
        return { label, raster: `${nx}x${ny}`, overDpLimit: nx * ny * ((nx + ny) / 2) > DP_WORK_LIMIT, result: describePack(packMixed(W, H, a, b)) };
      }),
    ).toMatchSnapshot();
  });

  it('packTwoLevel samples', () => {
    expect(INPUTS.map(([label, W, H, a, b]) => ({ label, result: describePack(packTwoLevel(W, H, a, b)) }))).toMatchSnapshot();
  });

  it('small results in full', () => {
    expect({
      mixed5x5: packMixed(5, 5, box(2, 3), box(3, 2)),
      twoLevel5x5: packTwoLevel(5, 5, box(2, 3), box(3, 2)),
      mixed10x10: packMixed(10, 10, box(3, 4), box(4, 3)),
      twoLevel10x10: packTwoLevel(10, 10, box(3, 4), box(4, 3)),
      mixed7x5: packMixed(7, 5, box(3, 2), box(2, 3)),
    }).toMatchSnapshot();
  });

  it('rasterPoints samples', () => {
    const small: [number, number, number][] = [
      [10, 3, 4],
      [0, 1, 1],
      [20, 5, 5],
      [12, 5, 7],
      [30, 7, 11],
      [9, 10, 20],
      [-1, 2, 3],
      [6, 2, 3],
    ];
    const big: [number, number, number][] = [
      [198_000, 32_000, 52_000],
      [285_000, 52_000, 32_000],
      [198_000, 7_300, 9_100],
      [285_000, 9_100, 7_300],
      [198_000, 102_000, 42_000],
      [297_000, 148_500, 105_000],
    ];
    expect({
      small: small.map(([limit, p, q]) => `rasterPoints(${limit}, ${p}, ${q}) = [${rasterPoints(limit, p, q).join(', ')}]`),
      big: big.map(([limit, p, q]) => {
        const r = rasterPoints(limit, p, q);
        return `rasterPoints(${limit}, ${p}, ${q}) -> ${r.length} points, first ${r.slice(0, 4).join(',')}, last ${r[r.length - 1]}, hash ${sha16(canon(r))}`;
      }),
    }).toMatchSnapshot();
  });
});

describe('golden: /how-it-works examples', () => {
  it('computeExamples + illustrationLayout', () => {
    const variants = Object.entries(VARIANTS).map(([name, settings]) => {
      const ill = illustrationLayout(settings);
      return {
        name,
        examples: computeExamples(settings).map((r) => canon(r)),
        illustration: ill ? outcomeLine('circle3', { ok: true, layout: ill }) : null,
      };
    });
    expect(variants).toMatchSnapshot();
  });
});
