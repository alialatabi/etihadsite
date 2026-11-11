/**
 * Layout engine. Pure functions, no I/O, no DOM.
 *
 * Contract (see docs/PLAN.md §2 and src/lib/types.ts):
 *  - Integer µm everywhere. Never produce fractional µm.
 *  - cols = floor((usable.width + gapX) / (cell.width + gapX)); rows likewise.
 *  - The block of cells is centred inside the usable area (floor the half-remainder).
 *  - Placements are row-major (row 0 left→right, then row 1, …).
 *  - Gaps are PAGE-axis properties: rotation swaps cell w/h only.
 *  - allowRotate: try both orientations, keep the higher count; ties → upright.
 *    Then also search MIXED layouts (upright + turned blocks, see ./pack.ts) and use one
 *    only when it fits STRICTLY more; such placements carry `turned: true`.
 *  - Failures: any side < minSideUm → 'too_small'; cols<1 || rows<1 in every
 *    allowed orientation → 'too_big_for_page'; NaN/negative/non-finite → 'invalid'.
 *  - Expected outputs for the fixtures in src/lib/__fixtures__/layout-cases.json
 *    must match EXACTLY (deep-equal), including placements order and block origin.
 *  - params.marks (the cutter dots, ./marks.ts): absent → everything above, unchanged. Present →
 *    cells near a dot are dropped and the arrangement is chosen on what is left (see
 *    layoutWithMarks); layoutParamsFor() always adds them.
 */
import { A4_UM } from '@/lib/units';
import { REG_MARKS, isNearMark, markCentres, markInsetUm } from './marks';
import { packMixed, type PackResult } from './pack';
import type {
  LayoutOutcome,
  LayoutParams,
  LayoutResult,
  LayoutSettings,
  Placement,
  RegMarks,
  Shape,
  StickerSpec,
} from '@/lib/types';

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const isNonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

type Area = LayoutResult['usable'];
type CellSize = LayoutResult['cell'];

/** Printable area of the A4 page inside `marginUm` on every side. */
function usableArea(marginUm: number): Area {
  return {
    xUm: marginUm,
    yUm: marginUm,
    widthUm: A4_UM.widthUm - 2 * marginUm,
    heightUm: A4_UM.heightUm - 2 * marginUm,
  };
}

/** A blockW × blockH block centred in `usable` (half-remainders floored). */
function centre(usable: Area, blockW: number, blockH: number): Area {
  return {
    xUm: usable.xUm + Math.floor((usable.widthUm - blockW) / 2),
    yUm: usable.yUm + Math.floor((usable.heightUm - blockH) / 2),
    widthUm: blockW,
    heightUm: blockH,
  };
}

/** `cell` as is, or with its sides swapped when `turned` (always a new object). */
function orientedCell(cell: CellSize, turned: boolean): CellSize {
  return turned
    ? { widthUm: cell.heightUm, heightUm: cell.widthUm }
    : { widthUm: cell.widthUm, heightUm: cell.heightUm };
}

/** Assemble the LayoutResult that the plain grid and the mixed layout share. */
function buildResult(
  params: LayoutParams,
  usable: Area,
  { cell, rotated, cols, rows, block, placements }: Pick<LayoutResult, 'cell' | 'rotated' | 'cols' | 'rows' | 'block' | 'placements'>,
): LayoutResult {
  return {
    page: { widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm },
    marginUm: params.marginUm,
    usable,
    cell,
    rotated,
    turnedCount: placements.filter((p) => p.turned).length,
    gapXUm: params.gapXUm,
    gapYUm: params.gapYUm,
    cols,
    rows,
    countPerSheet: placements.length,
    block,
    placements,
    clip: params.clip,
  };
}

/** Plain grid of cellW × cellH cells centred in `area`, or null when not even one fits. */
function attempt(area: Area, cellW: number, cellH: number, rotated: boolean, params: LayoutParams): LayoutResult | null {
  const cols = Math.floor((area.widthUm + params.gapXUm) / (cellW + params.gapXUm));
  const rows = Math.floor((area.heightUm + params.gapYUm) / (cellH + params.gapYUm));
  if (cols < 1 || rows < 1) return null;
  const blockW = cols * cellW + (cols - 1) * params.gapXUm;
  const blockH = rows * cellH + (rows - 1) * params.gapYUm;
  const block = centre(area, blockW, blockH);
  const placements: Placement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placements.push({ xUm: block.xUm + c * (cellW + params.gapXUm), yUm: block.yUm + r * (cellH + params.gapYUm) });
    }
  }
  return buildResult(params, area, { cell: { widthUm: cellW, heightUm: cellH }, rotated, cols, rows, block, placements });
}

/** Compute the arrangement of `spec` on one A4 sheet with `params`. */
export function computeLayout(spec: StickerSpec, params: LayoutParams): LayoutOutcome {
  if (!isPosInt(spec.widthUm) || !isPosInt(spec.heightUm)) return { ok: false, reason: 'invalid' };
  if (!isPosInt(params.minSideUm)) return { ok: false, reason: 'invalid' };
  if (!isNonNegInt(params.gapXUm) || !isNonNegInt(params.gapYUm) || !isNonNegInt(params.marginUm)) {
    return { ok: false, reason: 'invalid' };
  }
  if (2 * params.marginUm >= A4_UM.widthUm || 2 * params.marginUm >= A4_UM.heightUm) return { ok: false, reason: 'invalid' };
  const marks = params.marks;
  if (marks !== undefined && !validMarks(marks)) return { ok: false, reason: 'invalid' };
  if (spec.widthUm < params.minSideUm || spec.heightUm < params.minSideUm) return { ok: false, reason: 'too_small' };
  if (marks !== undefined) return layoutWithMarks(spec, params, marks);

  const usable = usableArea(params.marginUm);
  const upright = attempt(usable, spec.widthUm, spec.heightUm, false, params);
  const rotated = params.allowRotate ? attempt(usable, spec.heightUm, spec.widthUm, true, params) : null;
  let best = upright;
  if (rotated && (!best || rotated.countPerSheet > best.countPerSheet)) best = rotated;
  if (!best) return { ok: false, reason: 'too_big_for_page' };
  if (params.allowRotate && spec.widthUm !== spec.heightUm) {
    const mixed = mixedLayout(usable, spec.widthUm, spec.heightUm, params);
    if (mixed && mixed.countPerSheet > best.countPerSheet) best = mixed;
  }
  return { ok: true, layout: best };
}

function validMarks(m: RegMarks): boolean {
  return (
    typeof m === 'object' &&
    m !== null &&
    isNonNegInt(m.offsetUm) &&
    isPosInt(m.diameterUm) &&
    isNonNegInt(m.clearanceUm)
  );
}

/** One arrangement after the cells near a dot were dropped. */
interface MarkedOption {
  /** The arrangement as built, before removal (cell, rotated, cols, rows, block). */
  built: LayoutResult;
  kept: Placement[];
  removed: number;
}

/** Drop every placement of `built` whose printed shape comes near one of the dots. */
function dropNearMarks(built: LayoutResult, centres: { xUm: number; yUm: number }[], m: RegMarks): MarkedOption {
  const kept = built.placements.filter((p) => {
    const cell = { xUm: p.xUm, yUm: p.yUm, ...cellSizeFor(built, Boolean(p.turned)) };
    return !centres.some((c) => isNearMark(cell, built.clip, c, m));
  });
  return { built, kept, removed: built.placements.length - kept.length };
}

/** `a` beats `b`: more cells kept, then fewer removed. On a full tie the earlier candidate stays. */
function beats(a: MarkedOption, b: MarkedOption | null): boolean {
  if (!b) return true;
  if (a.kept.length !== b.kept.length) return a.kept.length > b.kept.length;
  return a.removed < b.removed;
}

/**
 * Best arrangement inside `area` once cells near the dots are dropped. Every option today's
 * engine considers (upright grid; rotated grid and mixed layout when rotation is allowed) is
 * built, filtered and compared on what is left. Ties: fewer removed, then upright < rotated < mixed.
 * `touched` tells whether ANY option (not only the winner) had a cell near a dot.
 */
function bestInArea(
  area: Area,
  spec: StickerSpec,
  params: LayoutParams,
  centres: { xUm: number; yUm: number }[],
  m: RegMarks,
): { best: MarkedOption | null; touched: boolean } {
  const options: (LayoutResult | null)[] = [attempt(area, spec.widthUm, spec.heightUm, false, params)];
  if (params.allowRotate) {
    options.push(attempt(area, spec.heightUm, spec.widthUm, true, params));
    if (spec.widthUm !== spec.heightUm) options.push(mixedLayout(area, spec.widthUm, spec.heightUm, params));
  }
  let best: MarkedOption | null = null;
  let touched = false;
  for (const built of options) {
    if (!built) continue;
    const option = dropNearMarks(built, centres, m);
    if (option.removed > 0) touched = true;
    if (beats(option, best)) best = option;
  }
  return { best, touched };
}

/**
 * Layout that keeps every sticker clear of the cutter dots (design A2). Area 1 is the usable
 * area; only when one of its options (upright, rotated or mixed, not only the winner) lost a cell
 * to a dot are area 2 (left and right moved in past the dots) and area 3 (top and bottom moved in)
 * tried too. (Checking only the winner let a plain grid that never touches a dot hide a better
 * inset arrangement, so a smaller margin could fit fewer.) When no option touches a dot, the inset
 * areas, which lie inside area 1, cannot do better, so the common case stays as fast as before.
 * Across areas: more kept, then fewer removed, then the lower area number.
 */
function layoutWithMarks(spec: StickerSpec, params: LayoutParams, m: RegMarks): LayoutOutcome {
  const centres = markCentres(m);
  const usable = usableArea(params.marginUm);
  const first = bestInArea(usable, spec, params, centres, m);
  let best = first.best;
  if (first.touched) {
    const inset = Math.max(params.marginUm, markInsetUm(m));
    const areas: Area[] = [];
    if (2 * inset < A4_UM.widthUm) areas.push({ ...usable, xUm: inset, widthUm: A4_UM.widthUm - 2 * inset });
    if (2 * inset < A4_UM.heightUm) areas.push({ ...usable, yUm: inset, heightUm: A4_UM.heightUm - 2 * inset });
    for (const area of areas) {
      const option = bestInArea(area, spec, params, centres, m).best;
      if (option && beats(option, best)) best = option;
    }
  }
  if (!best || best.kept.length === 0) return { ok: false, reason: 'too_big_for_page' };
  const { built, kept, removed } = best;
  const layout: LayoutResult = {
    ...built,
    usable,
    turnedCount: kept.filter((p) => p.turned).length,
    countPerSheet: kept.length,
    placements: kept,
    marks: { diameterUm: m.diameterUm, centres },
    removedNearMarks: removed,
  };
  return { ok: true, layout };
}

const packCache = new Map<string, PackResult | null>();
const PACK_CACHE_MAX = 48;

function cachedPack(W: number, H: number, aw: number, ah: number, bw: number, bh: number): PackResult | null {
  const key = `${W},${H},${aw},${ah},${bw},${bh}`;
  if (packCache.has(key)) return packCache.get(key)!;
  const r = packMixed(W, H, { w: aw, h: ah }, { w: bw, h: bh });
  if (packCache.size >= PACK_CACHE_MAX) packCache.delete(packCache.keys().next().value!);
  packCache.set(key, r);
  return r;
}

/** Best mixed-orientation layout (upright + turned cells) centred in `usable`, or null when nothing fits. */
function mixedLayout(usable: Area, w: number, h: number, params: LayoutParams): LayoutResult | null {
  const gx = params.gapXUm;
  const gy = params.gapYUm;
  const pack = cachedPack(usable.widthUm + gx, usable.heightUm + gy, w + gx, h + gy, h + gx, w + gy);
  if (!pack) return null;

  const base = pack.main.o;
  const upright: CellSize = { widthUm: w, heightUm: h };
  const sizeOf = (o: 0 | 1) => orientedCell(upright, o === 1);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pack.cells) {
    const d = sizeOf(c.o);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + d.widthUm);
    maxY = Math.max(maxY, c.y + d.heightUm);
  }
  const block = centre(usable, maxX - minX, maxY - minY);
  const placements: Placement[] = pack.cells
    .map((c): Placement => {
      const p: Placement = { xUm: block.xUm + c.x - minX, yUm: block.yUm + c.y - minY };
      if (c.o !== base) p.turned = true;
      return p;
    })
    .sort((p, q) => p.yUm - q.yUm || p.xUm - q.xUm);
  return buildResult(params, usable, {
    cell: sizeOf(base),
    rotated: base === 1,
    cols: pack.main.cols,
    rows: pack.main.rows,
    block,
    placements,
  });
}

/** Cell size on the page for an upright (`turned` false) or turned placement of `layout`. */
export function cellSizeFor(layout: LayoutResult, turned: boolean): { widthUm: number; heightUm: number } {
  return orientedCell(layout.cell, turned);
}

/** Size of placement `p` on the page (cell swapped when `turned`). */
export function placementSize(layout: LayoutResult, p: Placement): { widthUm: number; heightUm: number } {
  return cellSizeFor(layout, Boolean(p.turned));
}

/** Whether the artwork in placement `p` is turned 90° clockwise relative to the upload. */
export function placementRotated(layout: LayoutResult, p: Placement): boolean {
  return layout.rotated !== Boolean(p.turned);
}

/**
 * Derive the LayoutParams for a given spec from the shop's LayoutSettings:
 * circle → circleGapX/Y + clip circle; rect rounded → rectRoundedGap both axes +
 * clip roundedRect (radius = min(roundedRadiusUm, floor(min(w,h)/2)));
 * rect sharp → rectSharpGap both axes, clip none; custom → customGap both axes, clip none.
 * Every shape gets the cutter dots (REG_MARKS), so the website, the order route and the staff
 * page all keep stickers clear of them.
 */
export function layoutParamsFor(spec: StickerSpec, settings: LayoutSettings): LayoutParams {
  return { ...shapeParams(spec, settings), marks: { ...REG_MARKS } };
}

function shapeParams(spec: StickerSpec, settings: LayoutSettings): LayoutParams {
  const base = { marginUm: settings.marginUm, allowRotate: settings.allowRotate, minSideUm: settings.minSideUm };
  switch (spec.shape) {
    case 'circle':
      return { ...base, gapXUm: settings.circleGapXUm, gapYUm: settings.circleGapYUm, clip: { kind: 'circle' } };
    case 'rect': {
      if (spec.corners === 'sharp') {
        return { ...base, gapXUm: settings.rectSharpGapUm, gapYUm: settings.rectSharpGapUm, clip: { kind: 'none' } };
      }
      const radiusUm = Math.min(settings.roundedRadiusUm, Math.floor(Math.min(spec.widthUm, spec.heightUm) / 2));
      return { ...base, gapXUm: settings.rectRoundedGapUm, gapYUm: settings.rectRoundedGapUm, clip: { kind: 'roundedRect', radiusUm } };
    }
    case 'custom':
    default:
      return { ...base, gapXUm: settings.customGapUm, gapYUm: settings.customGapUm, clip: { kind: 'none' } };
  }
}

/**
 * Aspect-locked size derivation for the size inputs.
 * `aspect` = pxWidth / pxHeight of the DesignSource. Exactly one of the two
 * fields is given; the other is derived and ROUNDED TO THE NEAREST µm (not to 0.1 cm).
 * For shape 'circle' both dimensions equal the given one regardless of aspect.
 */
export function deriveLockedSize(
  shape: Shape,
  aspect: number,
  given: { widthUm: number } | { heightUm: number },
): { widthUm: number; heightUm: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const atLeast1 = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1);
  if ('widthUm' in given) {
    const widthUm = atLeast1(given.widthUm);
    return { widthUm, heightUm: shape === 'circle' ? widthUm : atLeast1(widthUm / a) };
  }
  const heightUm = atLeast1(given.heightUm);
  return { widthUm: shape === 'circle' ? heightUm : atLeast1(heightUm * a), heightUm };
}

/**
 * Largest width (µm) that still fits at least once with the given aspect
 * (considering rotation when params.allowRotate). Returns 0 when no width ≥ minSideUm
 * fits, or when the derived height would be < minSideUm ('ratio_extreme' in the UI).
 *
 * Fitting once is monotone in the width (also with the cutter dots), so the answer is found by
 * an exponential search from the closed-form estimate and then a binary search: a bounded number
 * of layout runs (about 100) instead of a 1 µm walk that the dots can stretch to thousands.
 * `layout` exists so tests can count the runs; callers leave it out.
 */
export function maxWidthFor(aspect: number, params: LayoutParams, layout: typeof computeLayout = computeLayout): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 0;
  const { widthUm: usableW, heightUm: usableH } = usableArea(params.marginUm);
  if (!(usableW > 0 && usableH > 0)) return 0;
  const heightOf = (w: number): number => Math.max(1, Math.round(w / aspect));
  const spec = (w: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w, heightUm: heightOf(w) });
  // Geometric fit only (minSide relaxed): fitting is monotone in w, so the upper bound is well defined.
  const loose: LayoutParams = { ...params, minSideUm: 1 };
  // Fitting ONCE never needs a mixed layout, so test the plain grids only (fast).
  const fits = (w: number): boolean => layout(spec(w), { ...loose, allowRotate: false }).ok ||
    (params.allowRotate && layout({ ...spec(w), widthUm: heightOf(w), heightUm: w }, { ...loose, allowRotate: false }).ok);
  // Closed-form estimate from the usable area (ignores the dots), then an exact search.
  const upright = Math.min(usableW, usableH * aspect);
  const turned = params.allowRotate ? Math.min(usableH, usableW * aspect) : 0;
  let w = Math.floor(Math.max(upright, turned));
  if (!Number.isFinite(w) || w < 1) w = 1;
  // Bracket the answer: fits(lo) and !fits(hi), lo < hi.
  let lo: number;
  let hi: number;
  if (fits(w)) {
    lo = w;
    for (let step = 1; ; step *= 2) {
      if (!fits(lo + step)) {
        hi = lo + step;
        break;
      }
      lo += step;
    }
  } else {
    hi = w;
    for (let step = 1; ; step *= 2) {
      if (hi === 1) return 0;
      const c = Math.max(1, hi - step);
      if (fits(c)) {
        lo = c;
        break;
      }
      hi = c;
    }
  }
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo >= params.minSideUm && layout(spec(lo), params).ok ? lo : 0;
}
