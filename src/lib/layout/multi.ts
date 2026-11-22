/**
 * Multi-design packer: N designs (same shape, each with its own size) on ONE A4 sheet, the same
 * number k of copies of EACH design. Pure, deterministic, integer µm, no I/O, runs in the browser
 * (while the customer types) and on the server.
 *
 * Rules (owner, 2026-11-22):
 *  - Every design is first run through computeLayout with its own params (rejects too-small /
 *    too-big / invalid designs, and gives the upper bound for k).
 *  - k is the largest number of copies of every design that fits on one sheet: inside the usable
 *    area, gapX between neighbours on a row, gapY between rows (page axes), no overlaps, and every
 *    cell clear of the 4 cutter dots (isNearMark, with THAT cell's displayed size and THAT design's clip).
 *  - Shelf packing: items = k copies of each design, tallest design first (ties: lower index),
 *    copies contiguous; shelves fill left to right, top to bottom. A candidate near a dot slides
 *    right in small steps; the first item of an empty shelf that cannot be placed anywhere on its
 *    row slides the whole shelf down instead.
 *  - Strategies (orientations: all upright, each landscape, each portrait, all turned; each with the
 *    first shelf sliding right or down past a dot) are tried and the one with the largest k wins; ties go to the earliest strategy. Circles and squares never turn.
 *  - The finished block is centred in the usable area when that keeps every cell clear of the dots.
 *
 * Single-design orders do NOT go through here; they keep using computeLayout.
 */
import { MAX_DESIGNS } from '@/config/defaults';
import { A4_UM } from '@/lib/units';
import type {
  LayoutParams,
  LayoutSettings,
  MultiLayoutDesign,
  MultiLayoutOutcome,
  MultiPlacement,
  RegMarks,
  StickerSpec,
} from '@/lib/types';
import { computeLayout, layoutParamsFor } from './index';
import { isNearMark, markCentres } from './marks';
import { shapeKeyOf } from './spacing';

/** How far a cell that is near a dot (or a shelf that cannot be placed) slides, in µm. */
const STEP_UM = 500;

interface Area {
  xUm: number;
  yUm: number;
  widthUm: number;
  heightUm: number;
}

interface Dot {
  xUm: number;
  yUm: number;
}

/** One cell as laid out: which design, where, how big on the page, turned or not. */
interface Cell {
  design: number;
  x: number;
  y: number;
  w: number;
  h: number;
  turned: boolean;
}

/** Per design: whether the strategy turns it (its cell with width and height swapped). */
type Orientation = boolean[];

/**
 * One way to pack: how each design is oriented, and what the first shelf does when its first cell
 * is near a dot. `slideDown` false: the cell slides right. `slideDown` true: the whole first shelf
 * slides down instead (like the single-design layout's inset top and bottom area).
 */
interface Strategy {
  turned: Orientation;
  slideDown: boolean;
}

interface Ctx {
  usable: Area;
  gapX: number;
  gapY: number;
  sizes: { w: number; h: number }[];
  clips: LayoutParams['clip'][];
  dots: Dot[];
  marks: RegMarks;
}

function nearAnyDot(ctx: Ctx, design: number, x: number, y: number, w: number, h: number): boolean {
  const clip = ctx.clips[design];
  const cell = { xUm: x, yUm: y, widthUm: w, heightUm: h };
  for (const dot of ctx.dots) if (isNearMark(cell, clip, dot, ctx.marks)) return true;
  return false;
}

/**
 * Shelf-pack `k` copies of every design in the given orientation. Returns the cells (placement
 * order) or null when they do not all fit.
 */
function pack(ctx: Ctx, k: number, { turned, slideDown }: Strategy): Cell[] | null {
  const { usable, gapX, gapY, sizes } = ctx;
  const n = sizes.length;
  const dims = sizes.map((s, i) => (turned[i] ? { w: s.h, h: s.w } : { w: s.w, h: s.h }));
  const order = dims.map((_, i) => i).sort((a, b) => dims[b].h - dims[a].h || a - b);
  const right = usable.xUm + usable.widthUm;
  const bottom = usable.yUm + usable.heightUm;

  const cells: Cell[] = [];
  let x = usable.xUm;
  let y = usable.yUm;
  let shelfH = 0;
  let inShelf = 0;
  let shelfNo = 0;

  for (let o = 0; o < n; o++) {
    const d = order[o];
    const { w, h } = dims[d];
    if (w > usable.widthUm || h > usable.heightUm) return null;
    for (let copy = 0; copy < k; copy++) {
      for (;;) {
        if (y + h > bottom) return null;
        if (x + w > right) {
          if (inShelf === 0) {
            // Nothing placed on this shelf and the item fits nowhere on the row: slide the shelf down.
            y += STEP_UM;
          } else {
            y += shelfH + gapY;
            shelfH = 0;
            inShelf = 0;
            shelfNo++;
          }
          x = usable.xUm;
          continue;
        }
        if (nearAnyDot(ctx, d, x, y, w, h)) {
          if (slideDown && shelfNo === 0 && inShelf === 0 && x === usable.xUm) y += STEP_UM;
          else x += STEP_UM;
          continue;
        }
        break;
      }
      cells.push({ design: d, x, y, w, h, turned: turned[d] });
      x += w + gapX;
      if (h > shelfH) shelfH = h;
      inShelf++;
    }
  }
  return cells;
}

/**
 * Largest k in [1, ub] that `pack` can place for this orientation, or 0 when k = 1 does not fit.
 * Binary search, then a linear probe upwards (greedy feasibility is not strictly monotone).
 */
function bestK(ctx: Ctx, strategy: Strategy, ub: number): { k: number; cells: Cell[] | null } {
  let bestCells = pack(ctx, 1, strategy);
  if (!bestCells) return { k: 0, cells: null };
  let lo = 1;
  let hi = ub;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    const cells = pack(ctx, mid, strategy);
    if (cells) {
      lo = mid;
      bestCells = cells;
    } else {
      hi = mid - 1;
    }
  }
  while (lo < ub) {
    const cells = pack(ctx, lo + 1, strategy);
    if (!cells) break;
    lo += 1;
    bestCells = cells;
  }
  return { k: lo, cells: bestCells };
}

/** The strategies to try, earliest first, without duplicates: each orientation vector, slide right then down. */
function strategies(sizes: { w: number; h: number }[], allowRotate: boolean): Strategy[] {
  const upright: Orientation = sizes.map(() => false);
  const list: Orientation[] = [upright];
  if (allowRotate) {
    list.push(sizes.map((s) => s.w < s.h)); // each design landscape (w >= h)
    list.push(sizes.map((s) => s.w > s.h)); // each design portrait (h >= w)
    list.push(sizes.map((s) => s.w !== s.h)); // everything turned
  }
  const seen = new Set<string>();
  const out: Strategy[] = [];
  for (const turned of list) {
    const key = turned.map((t) => (t ? '1' : '0')).join('');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ turned, slideDown: false }, { turned, slideDown: true });
  }
  return out;
}

/**
 * Lay out `specs` (1..MAX_DESIGNS designs sharing one shape) on one A4 sheet with the same number
 * of copies of each. See the file header for the rules.
 */
export function computeMultiLayout(specs: StickerSpec[], settings: LayoutSettings): MultiLayoutOutcome {
  const n = specs.length;
  if (n < 1 || n > MAX_DESIGNS) return { ok: false, reason: 'invalid' };
  const key = shapeKeyOf(specs[0]);
  for (let i = 1; i < n; i++) if (shapeKeyOf(specs[i]) !== key) return { ok: false, reason: 'invalid' };

  // Per design: its own params (clip depends on the size), the single-design check, its count as bound.
  const params: LayoutParams[] = [];
  const memo = new Map<string, { params: LayoutParams; count: number }>();
  let ub = Infinity;
  for (let i = 0; i < n; i++) {
    const spec = specs[i];
    const memoKey = `${spec.widthUm},${spec.heightUm}`;
    let hit = memo.get(memoKey);
    if (!hit) {
      const p = layoutParamsFor(spec, settings);
      const single = computeLayout(spec, p);
      if (!single.ok) return { ok: false, reason: single.reason, designIndex: i };
      hit = { params: p, count: single.layout.countPerSheet };
      memo.set(memoKey, hit);
    }
    params.push(hit.params);
    ub = Math.min(ub, hit.count);
  }
  const p0 = params[0];
  for (const p of params) {
    if (
      p.marginUm !== p0.marginUm ||
      p.gapXUm !== p0.gapXUm ||
      p.gapYUm !== p0.gapYUm ||
      p.allowRotate !== p0.allowRotate ||
      p.minSideUm !== p0.minSideUm ||
      p.clip.kind !== p0.clip.kind
    ) {
      return { ok: false, reason: 'invalid' };
    }
  }
  const marks = p0.marks;
  if (!marks) return { ok: false, reason: 'invalid' };

  const usable: Area = {
    xUm: p0.marginUm,
    yUm: p0.marginUm,
    widthUm: A4_UM.widthUm - 2 * p0.marginUm,
    heightUm: A4_UM.heightUm - 2 * p0.marginUm,
  };
  const sizes = specs.map((s) => ({ w: s.widthUm, h: s.heightUm }));
  const ctx: Ctx = {
    usable,
    gapX: p0.gapXUm,
    gapY: p0.gapYUm,
    sizes,
    clips: params.map((p) => p.clip),
    dots: markCentres(marks),
    marks,
  };

  // Area bound: every cell plus its gap owns (w + gapX) × (h + gapY) of the usable area plus one gap.
  let perCopyArea = 0;
  for (const s of sizes) perCopyArea += (s.w + ctx.gapX) * (s.h + ctx.gapY);
  const areaBound = Math.floor(((usable.widthUm + ctx.gapX) * (usable.heightUm + ctx.gapY)) / perCopyArea);
  ub = Math.max(1, Math.min(ub, areaBound));

  let bestFound = 0;
  let bestCells: Cell[] | null = null;
  for (const strategy of strategies(sizes, p0.allowRotate)) {
    const r = bestK(ctx, strategy, ub);
    if (r.k > bestFound) {
      bestFound = r.k;
      bestCells = r.cells;
    }
  }
  if (!bestCells || bestFound < 1) return { ok: false, reason: 'too_big_for_page' };

  // Centre the block; keep the un-centred cells when the move would bring one near a dot.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of bestCells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  const dx = usable.xUm + Math.floor((usable.widthUm - (maxX - minX)) / 2) - minX;
  const dy = usable.yUm + Math.floor((usable.heightUm - (maxY - minY)) / 2) - minY;
  const moved = bestCells.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  let cells = bestCells;
  if (!moved.some((c) => nearAnyDot(ctx, c.design, c.x, c.y, c.w, c.h))) {
    cells = moved;
    minX += dx;
    maxX += dx;
    minY += dy;
    maxY += dy;
  }

  const placements: MultiPlacement[] = cells
    .map((c): MultiPlacement => {
      const p: MultiPlacement = { designIndex: c.design, xUm: c.x, yUm: c.y };
      if (c.turned) p.turned = true;
      return p;
    })
    .sort((a, b) => a.yUm - b.yUm || a.xUm - b.xUm);

  const designs: MultiLayoutDesign[] = specs.map((s, i) => ({
    cell: { widthUm: s.widthUm, heightUm: s.heightUm },
    clip: params[i].clip,
  }));

  return {
    ok: true,
    layout: {
      kind: 'multi',
      page: { widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm },
      marginUm: p0.marginUm,
      usable,
      gapXUm: ctx.gapX,
      gapYUm: ctx.gapY,
      designs,
      perDesign: bestFound,
      countPerSheet: n * bestFound,
      block: { xUm: minX, yUm: minY, widthUm: maxX - minX, heightUm: maxY - minY },
      placements,
      marks: { diameterUm: marks.diameterUm, centres: ctx.dots },
    },
  };
}
