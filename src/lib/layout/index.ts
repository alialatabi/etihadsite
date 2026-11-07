/**
 * Layout engine — OWNED BY AGENT A. Pure functions, no I/O, no DOM.
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
 *
 * Phase 0 ships a reference implementation of computeLayout/layoutParamsFor
 * (ported from the fixture generator). Agent A: keep behaviour, harden input
 * validation, add exhaustive tests, and implement the remaining helpers.
 */
import { A4_UM } from '@/lib/units';
import { packMixed, type PackResult } from './pack';
import type {
  ClipShape,
  LayoutOutcome,
  LayoutParams,
  LayoutResult,
  LayoutSettings,
  Placement,
  Shape,
  StickerSpec,
} from '@/lib/types';

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const isNonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function attempt(cellW: number, cellH: number, rotated: boolean, params: LayoutParams): LayoutResult | null {
  const usable = {
    xUm: params.marginUm,
    yUm: params.marginUm,
    widthUm: A4_UM.widthUm - 2 * params.marginUm,
    heightUm: A4_UM.heightUm - 2 * params.marginUm,
  };
  const cols = Math.floor((usable.widthUm + params.gapXUm) / (cellW + params.gapXUm));
  const rows = Math.floor((usable.heightUm + params.gapYUm) / (cellH + params.gapYUm));
  if (cols < 1 || rows < 1) return null;
  const blockW = cols * cellW + (cols - 1) * params.gapXUm;
  const blockH = rows * cellH + (rows - 1) * params.gapYUm;
  const ox = usable.xUm + Math.floor((usable.widthUm - blockW) / 2);
  const oy = usable.yUm + Math.floor((usable.heightUm - blockH) / 2);
  const placements: Placement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placements.push({ xUm: ox + c * (cellW + params.gapXUm), yUm: oy + r * (cellH + params.gapYUm) });
    }
  }
  return {
    page: { widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm },
    marginUm: params.marginUm,
    usable,
    cell: { widthUm: cellW, heightUm: cellH },
    rotated,
    turnedCount: 0,
    gapXUm: params.gapXUm,
    gapYUm: params.gapYUm,
    cols,
    rows,
    countPerSheet: cols * rows,
    block: { xUm: ox, yUm: oy, widthUm: blockW, heightUm: blockH },
    placements,
    clip: params.clip,
  };
}

/** Compute the arrangement of `spec` on one A4 sheet with `params`. */
export function computeLayout(spec: StickerSpec, params: LayoutParams): LayoutOutcome {
  if (!isPosInt(spec.widthUm) || !isPosInt(spec.heightUm)) return { ok: false, reason: 'invalid' };
  if (!isPosInt(params.minSideUm)) return { ok: false, reason: 'invalid' };
  if (!isNonNegInt(params.gapXUm) || !isNonNegInt(params.gapYUm) || !isNonNegInt(params.marginUm)) {
    return { ok: false, reason: 'invalid' };
  }
  if (2 * params.marginUm >= A4_UM.widthUm || 2 * params.marginUm >= A4_UM.heightUm) return { ok: false, reason: 'invalid' };
  if (spec.widthUm < params.minSideUm || spec.heightUm < params.minSideUm) return { ok: false, reason: 'too_small' };

  const upright = attempt(spec.widthUm, spec.heightUm, false, params);
  const rotated = params.allowRotate ? attempt(spec.heightUm, spec.widthUm, true, params) : null;
  let best = upright;
  if (rotated && (!best || rotated.countPerSheet > best.countPerSheet)) best = rotated;
  if (!best) return { ok: false, reason: 'too_big_for_page' };
  if (params.allowRotate && spec.widthUm !== spec.heightUm) {
    const mixed = mixedLayout(spec.widthUm, spec.heightUm, params);
    if (mixed && mixed.countPerSheet > best.countPerSheet) best = mixed;
  }
  return { ok: true, layout: best };
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

/** Best mixed-orientation layout (upright + turned cells), or null when nothing fits. */
function mixedLayout(w: number, h: number, params: LayoutParams): LayoutResult | null {
  const usable = {
    xUm: params.marginUm,
    yUm: params.marginUm,
    widthUm: A4_UM.widthUm - 2 * params.marginUm,
    heightUm: A4_UM.heightUm - 2 * params.marginUm,
  };
  const gx = params.gapXUm;
  const gy = params.gapYUm;
  const pack = cachedPack(usable.widthUm + gx, usable.heightUm + gy, w + gx, h + gy, h + gx, w + gy);
  if (!pack) return null;

  const base = pack.main.o;
  const dims = (o: 0 | 1) => (o === 0 ? { w, h } : { w: h, h: w });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pack.cells) {
    const d = dims(c.o);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + d.w);
    maxY = Math.max(maxY, c.y + d.h);
  }
  const blockW = maxX - minX;
  const blockH = maxY - minY;
  const bx = usable.xUm + Math.floor((usable.widthUm - blockW) / 2);
  const by = usable.yUm + Math.floor((usable.heightUm - blockH) / 2);
  const placements: Placement[] = pack.cells
    .map((c): Placement => {
      const p: Placement = { xUm: bx + c.x - minX, yUm: by + c.y - minY };
      if (c.o !== base) p.turned = true;
      return p;
    })
    .sort((p, q) => p.yUm - q.yUm || p.xUm - q.xUm);
  const cell = dims(base);
  return {
    page: { widthUm: A4_UM.widthUm, heightUm: A4_UM.heightUm },
    marginUm: params.marginUm,
    usable,
    cell: { widthUm: cell.w, heightUm: cell.h },
    rotated: base === 1,
    turnedCount: placements.filter((p) => p.turned).length,
    gapXUm: gx,
    gapYUm: gy,
    cols: pack.main.cols,
    rows: pack.main.rows,
    countPerSheet: placements.length,
    block: { xUm: bx, yUm: by, widthUm: blockW, heightUm: blockH },
    placements,
    clip: params.clip,
  };
}

/** Size of placement `p` on the page (cell swapped when `turned`). */
export function placementSize(layout: LayoutResult, p: Placement): { widthUm: number; heightUm: number } {
  return p.turned
    ? { widthUm: layout.cell.heightUm, heightUm: layout.cell.widthUm }
    : { widthUm: layout.cell.widthUm, heightUm: layout.cell.heightUm };
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
 */
export function layoutParamsFor(spec: StickerSpec, settings: LayoutSettings): LayoutParams {
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
 */
export function maxWidthFor(aspect: number, params: LayoutParams): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 0;
  const usableW = A4_UM.widthUm - 2 * params.marginUm;
  const usableH = A4_UM.heightUm - 2 * params.marginUm;
  if (!(usableW > 0 && usableH > 0)) return 0;
  const heightOf = (w: number): number => Math.max(1, Math.round(w / aspect));
  const spec = (w: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: w, heightUm: heightOf(w) });
  // Geometric fit only (minSide relaxed): fitting is monotone in w, so the upper bound is well defined.
  const loose: LayoutParams = { ...params, minSideUm: 1 };
  // Fitting ONCE never needs a mixed layout, so test the plain grids only (fast).
  const fits = (w: number): boolean => computeLayout(spec(w), { ...loose, allowRotate: false }).ok ||
    (params.allowRotate && computeLayout({ ...spec(w), widthUm: heightOf(w), heightUm: w }, { ...loose, allowRotate: false }).ok);
  // Closed-form estimate from the usable area, then exact verification.
  const upright = Math.min(usableW, usableH * aspect);
  const turned = params.allowRotate ? Math.min(usableH, usableW * aspect) : 0;
  let w = Math.floor(Math.max(upright, turned));
  if (!Number.isFinite(w) || w < 1) w = 1;
  while (w > 1 && !fits(w)) w--;
  while (fits(w + 1)) w++;
  if (!fits(w)) return 0;
  return w >= params.minSideUm && computeLayout(spec(w), params).ok ? w : 0;
}

export type { ClipShape };
