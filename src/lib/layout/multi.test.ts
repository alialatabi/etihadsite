import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MAX_DESIGNS } from '@/config/defaults';
import { A4_UM } from '@/lib/units';
import type { LayoutSettings, MultiLayoutOutcome, MultiLayoutResult, StickerSpec } from '@/lib/types';
import { computeMultiLayout } from './index';
import { REG_MARKS, isNearMark } from './marks';

const MM = 1_000;
const SETTINGS: LayoutSettings = DEFAULT_SETTINGS.layout;
const ROTATE: LayoutSettings = { ...SETTINGS, allowRotate: true };

/** The four cutter dots, spelled out (not taken from marks.ts) so the check is independent. */
const DOTS = [
  { xUm: 7_000, yUm: 7_000 },
  { xUm: A4_UM.widthUm - 7_000, yUm: 7_000 },
  { xUm: 7_000, yUm: A4_UM.heightUm - 7_000 },
  { xUm: A4_UM.widthUm - 7_000, yUm: A4_UM.heightUm - 7_000 },
];

const circle = (mm: number): StickerSpec => ({ shape: 'circle', widthUm: mm * MM, heightUm: mm * MM });
const rect = (w: number, h: number, corners: 'rounded' | 'sharp' = 'sharp'): StickerSpec => ({
  shape: 'rect',
  corners,
  widthUm: Math.round(w * MM),
  heightUm: Math.round(h * MM),
});
const custom = (w: number, h: number): StickerSpec => ({ shape: 'custom', widthUm: Math.round(w * MM), heightUm: Math.round(h * MM) });

function layoutOf(o: MultiLayoutOutcome): MultiLayoutResult {
  if (!o.ok) throw new Error(`expected a layout, got ${o.reason} (design ${o.designIndex})`);
  return o.layout;
}

/** mulberry32: small seeded PRNG so the property test is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plain check for the hot loops (a vitest `expect` per cell is far too slow here). */
function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

/** Every invariant of a multi layout, checked from scratch. */
function assertValid(l: MultiLayoutResult, settings: LayoutSettings): void {
  const n = l.designs.length;
  expect(l.kind).toBe('multi');
  expect(l.perDesign).toBeGreaterThanOrEqual(1);
  expect(l.countPerSheet).toBe(n * l.perDesign);
  expect(l.placements.length).toBe(l.countPerSheet);
  expect(l.page).toEqual({ widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm });
  expect(l.usable).toEqual({
    xUm: l.marginUm,
    yUm: l.marginUm,
    widthUm: A4_UM.widthUm - 2 * l.marginUm,
    heightUm: A4_UM.heightUm - 2 * l.marginUm,
  });
  expect(settings.marginUm).toBe(l.marginUm);

  const counts = new Array<number>(n).fill(0);
  const boxes = l.placements.map((p) => {
    must(Number.isInteger(p.xUm) && Number.isInteger(p.yUm), 'non-integer coordinate');
    must(!('turned' in p) || p.turned === true, 'turned must be true or absent');
    const d = l.designs[p.designIndex];
    counts[p.designIndex]++;
    const w = p.turned ? d.cell.heightUm : d.cell.widthUm;
    const h = p.turned ? d.cell.widthUm : d.cell.heightUm;
    return { p, d, x: p.xUm, y: p.yUm, w, h };
  });
  expect(counts.every((c) => c === l.perDesign)).toBe(true);

  const ux = l.usable.xUm;
  const uy = l.usable.yUm;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    // inside the usable area
    must(b.x >= ux && b.y >= uy, 'cell starts outside the usable area');
    must(b.x + b.w <= ux + l.usable.widthUm && b.y + b.h <= uy + l.usable.heightUm, 'cell ends outside the usable area');
    // clear of every dot, with this cell's own displayed size and this design's clip
    for (const dot of DOTS) {
      must(!isNearMark({ xUm: b.x, yUm: b.y, widthUm: b.w, heightUm: b.h }, b.d.clip, dot, REG_MARKS), 'cell near a dot');
    }
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  expect(l.block).toEqual({ xUm: minX, yUm: minY, widthUm: maxX - minX, heightUm: maxY - minY });

  // no overlaps, gaps respected on the page axes
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const xSep = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const ySep = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      must(xSep >= l.gapXUm || ySep >= l.gapYUm, `cells ${i} and ${j} are closer than the gaps (xSep ${xSep}, ySep ${ySep})`);
    }
  }

  // sorted by y, then x
  for (let i = 1; i < l.placements.length; i++) {
    const a = l.placements[i - 1];
    const b = l.placements[i];
    must(a.yUm < b.yUm || (a.yUm === b.yUm && a.xUm <= b.xUm), 'placements not sorted by y then x');
  }
  expect(l.marks).toEqual({ diameterUm: REG_MARKS.diameterUm, centres: DOTS });
}

/** Random spec sets: 1..8 designs of one shape, sides 5..120 mm. */
function randomSets(count: number, seed: number): StickerSpec[][] {
  const rnd = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const sets: StickerSpec[][] = [];
  for (let s = 0; s < count; s++) {
    const n = int(1, MAX_DESIGNS);
    const shape = ['circle', 'rect-rounded', 'rect-sharp', 'custom'][int(0, 3)];
    // Most sets are small enough to fit; some are big on purpose.
    const maxMm = [25, 40, 70, 120][int(0, 3)];
    const set: StickerSpec[] = [];
    for (let i = 0; i < n; i++) {
      const wUm = int(5_000, maxMm * MM);
      const hUm = int(5_000, maxMm * MM);
      if (shape === 'circle') set.push({ shape: 'circle', widthUm: wUm, heightUm: wUm });
      else if (shape === 'custom') set.push({ shape: 'custom', widthUm: wUm, heightUm: hUm });
      else set.push({ shape: 'rect', corners: shape === 'rect-sharp' ? 'sharp' : 'rounded', widthUm: wUm, heightUm: hUm });
    }
    sets.push(set);
  }
  return sets;
}

describe('computeMultiLayout: properties', { timeout: 30_000 }, () => {
  for (const [name, settings] of [['no rotation', SETTINGS], ['rotation allowed', ROTATE]] as const) {
    it(`random sets keep every invariant (${name})`, () => {
      const sets = randomSets(80, name === 'no rotation' ? 1234 : 98765);
      let okCount = 0;
      for (const set of sets) {
        const out = computeMultiLayout(set, settings);
        if (!out.ok) {
          expect(['too_big_for_page', 'too_small']).toContain(out.reason);
          continue;
        }
        okCount++;
        assertValid(out.layout, settings);
        // designs echo the specs
        expect(out.layout.designs.map((d) => d.cell)).toEqual(set.map((s) => ({ widthUm: s.widthUm, heightUm: s.heightUm })));
        // determinism
        expect(computeMultiLayout(set, settings)).toEqual(out);
      }
      // the test must not pass vacuously
      expect(okCount).toBeGreaterThanOrEqual(sets.length * 0.4);
    });
  }

  it('allowing rotation never lowers k', () => {
    for (const set of randomSets(50, 555)) {
      const a = computeMultiLayout(set, SETTINGS);
      const b = computeMultiLayout(set, ROTATE);
      if (a.ok) {
        expect(b.ok).toBe(true);
        if (b.ok) expect(b.layout.perDesign).toBeGreaterThanOrEqual(a.layout.perDesign);
      }
    }
  });

  it('only turns designs when rotation is allowed, and never a circle or a square', () => {
    for (const set of randomSets(40, 77)) {
      const off = computeMultiLayout(set, SETTINGS);
      if (off.ok) expect(off.layout.placements.every((p) => p.turned === undefined)).toBe(true);
      const on = computeMultiLayout(set, ROTATE);
      if (on.ok) {
        for (const p of on.layout.placements) {
          const d = on.layout.designs[p.designIndex];
          if (p.turned) expect(d.cell.widthUm).not.toBe(d.cell.heightUm);
        }
      }
    }
  });

  it('a single design is valid too', () => {
    for (const spec of [circle(30), rect(60, 40), rect(200, 100), custom(10, 90)]) {
      assertValid(layoutOf(computeMultiLayout([spec], SETTINGS)), SETTINGS);
    }
  });
});

describe('computeMultiLayout: hand-checked examples', () => {
  it('two 50 mm circles: 3 per row, 5 rows, so 7 of each', () => {
    const l = layoutOf(computeMultiLayout([circle(50), circle(50)], SETTINGS));
    // usable 204 x 291 mm, 2 mm between columns, none between rows: 3 x 5 = 15 cells at most,
    // so 14 circles = 7 of each.
    expect(l.perDesign).toBe(7);
    expect(l.countPerSheet).toBe(14);
    expect(l.gapXUm).toBe(2_000);
    expect(l.gapYUm).toBe(0);
    expect(l.designs[0].clip).toEqual({ kind: 'circle' });
    assertValid(l, SETTINGS);
  });

  it('30x20 and 60x40 sharp rectangles: 16 of each', () => {
    const l = layoutOf(computeMultiLayout([rect(30, 20), rect(60, 40)], SETTINGS));
    // The 60x40 ones go first: 3 per row (180 mm of 204), 16 of them = 5 full rows + 1 left over;
    // the left-over row also takes 4 of the 30x20, and the other 12 need 2 more rows of 6:
    // 6 x 40 + 2 x 20 = 280 mm of the 291 mm usable height. 17 would need 300 mm.
    expect(l.perDesign).toBe(16);
    expect(l.countPerSheet).toBe(32);
    expect(l.placements.filter((p) => p.designIndex === 0).length).toBe(16);
    expect(l.placements.filter((p) => p.designIndex === 1).length).toBe(16);
    assertValid(l, SETTINGS);
  });

  it('100x100 sharp squares: the first row slides down clear of the dots', () => {
    const l = layoutOf(computeMultiLayout([rect(100, 100)], SETTINGS));
    // 2 per row (200 of 204 mm). Sliding right past the top-left dot leaves room for 1 only, so the
    // first row goes down to 12.5 mm (clear of both top dots): 2 rows (200 of 278 mm) = 4 per sheet.
    expect(l.perDesign).toBe(4);
    assertValid(l, SETTINGS);
  });

  it('a 200x100 mm design is slid down clear of the top dots instead of being refused', () => {
    const l = layoutOf(computeMultiLayout([rect(200, 100)], SETTINGS));
    expect(l.perDesign).toBe(2);
    const top = l.placements.filter((p) => p.yUm === l.placements[0].yUm)[0];
    // 7 mm dot centre + 5.5 mm keep-out: the top edge sits at 12.5 mm or lower.
    expect(top.yUm).toBeGreaterThanOrEqual(12_500);
    assertValid(l, SETTINGS);
  });

  it('turns a tall design when that lets more fit (rotation allowed)', () => {
    // 20x150 mm strips: upright only 10 across (204 / 20), 1 row; turned (150x20): 1 across, 14 rows.
    const set = [rect(20, 150)];
    const off = layoutOf(computeMultiLayout(set, SETTINGS));
    const on = layoutOf(computeMultiLayout(set, ROTATE));
    expect(on.perDesign).toBeGreaterThanOrEqual(off.perDesign);
    assertValid(off, SETTINGS);
    assertValid(on, ROTATE);
  });

  it('output carries no stray keys on a placement', () => {
    const l = layoutOf(computeMultiLayout([rect(40, 40), rect(30, 30)], SETTINGS));
    for (const p of l.placements) expect(Object.keys(p)).toEqual(['designIndex', 'xUm', 'yUm']);
  });
});

describe('computeMultiLayout: failures', () => {
  it('rejects an empty list and more than MAX_DESIGNS', () => {
    expect(computeMultiLayout([], SETTINGS)).toEqual({ ok: false, reason: 'invalid' });
    const nine = Array.from({ length: MAX_DESIGNS + 1 }, () => rect(20, 20));
    expect(computeMultiLayout(nine, SETTINGS)).toEqual({ ok: false, reason: 'invalid' });
    const eight = Array.from({ length: MAX_DESIGNS }, () => rect(20, 20));
    expect(computeMultiLayout(eight, SETTINGS).ok).toBe(true);
  });

  it('rejects designs of different shapes or corners', () => {
    expect(computeMultiLayout([circle(30), rect(30, 30)], SETTINGS)).toEqual({ ok: false, reason: 'invalid' });
    expect(computeMultiLayout([rect(30, 30, 'sharp'), rect(30, 30, 'rounded')], SETTINGS)).toEqual({ ok: false, reason: 'invalid' });
    expect(computeMultiLayout([custom(30, 30), rect(30, 30)], SETTINGS)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('names the design that is too small', () => {
    expect(computeMultiLayout([rect(30, 30), rect(30, 4)], SETTINGS)).toEqual({ ok: false, reason: 'too_small', designIndex: 1 });
    expect(computeMultiLayout([circle(3), circle(30)], SETTINGS)).toEqual({ ok: false, reason: 'too_small', designIndex: 0 });
  });

  it('names the design that is too big for the page alone', () => {
    const out = computeMultiLayout([rect(30, 30), rect(30, 30), rect(250, 100)], SETTINGS);
    expect(out).toEqual({ ok: false, reason: 'too_big_for_page', designIndex: 2 });
  });

  it('names the design with invalid numbers', () => {
    const bad: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 30.5, heightUm: 30_000 };
    expect(computeMultiLayout([rect(30, 30), bad], SETTINGS)).toEqual({ ok: false, reason: 'invalid', designIndex: 1 });
  });

  it('refuses designs that each fit alone but not together', () => {
    // 150x200 fits alone (1 per sheet) but two of them need 400 mm of height or 300 mm of width.
    expect(computeMultiLayout([rect(150, 200), rect(150, 200)], SETTINGS)).toEqual({ ok: false, reason: 'too_big_for_page' });
    expect(computeMultiLayout([rect(150, 200), rect(150, 200)], ROTATE)).toEqual({ ok: false, reason: 'too_big_for_page' });
  });
});

describe('computeMultiLayout: speed', () => {
  it('8 designs of 10 mm on A4 take well under 200 ms', () => {
    const set = Array.from({ length: 8 }, (_, i) => rect(10 + (i % 2), 10));
    const same = Array.from({ length: 8 }, () => rect(10, 10));
    for (const s of [set, same]) {
      computeMultiLayout(s, ROTATE); // warm up
      const t0 = performance.now();
      const l = layoutOf(computeMultiLayout(s, ROTATE));
      const ms = performance.now() - t0;
      console.info(`multi layout, 8 designs of ~10 mm: ${ms.toFixed(1)} ms, k = ${l.perDesign}`);
      expect(ms).toBeLessThan(200);
      assertValid(l, ROTATE);
    }
  });
});
