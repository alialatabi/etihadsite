/**
 * Mixed-orientation packing of identical stickers on one sheet (pure, integer µm).
 *
 * Problem: place as many w×h stickers as possible in the usable area, each either
 * upright or turned 90°, keeping at least gapX between horizontally adjacent cells and
 * gapY between vertically adjacent ones (gaps are PAGE-axis properties).
 *
 * Gap trick: inflate every cell by (gapX, gapY) to the right/bottom and the container
 * by the same amount. Inflated cells that do not overlap ⇔ the real cells keep the gaps.
 *
 * Search: exact guillotine dynamic programme over raster points (positions that are
 * sums of cell widths/heights — no optimal guillotine pattern needs any other cut), then a
 * first-order non-guillotine "pinwheel" (5-block) pass whose blocks reuse the DP table.
 * Leaves are uniform grids of one orientation; a cut is only taken when it is STRICTLY
 * better, so the simplest pattern wins ties. Fixed orientation alone is always solved
 * optimally by the plain grid, so this runs only when rotation is allowed and w ≠ h.
 */

export interface Box {
  w: number;
  h: number;
}

export interface PackedCell {
  /** Top-left in inflated coordinates (= real top-left), relative to the region origin. */
  x: number;
  y: number;
  /** 0 = orientation A (upright), 1 = orientation B (turned). */
  o: 0 | 1;
}

export interface PackResult {
  count: number;
  cells: PackedCell[];
  /** Largest uniform leaf: its orientation and grid, used for cols/rows reporting. */
  main: { o: 0 | 1; cols: number; rows: number };
}

/** Sorted, de-duplicated {i·p + j·q ≤ limit}. */
export function rasterPoints(limit: number, p: number, q: number): number[] {
  const set = new Set<number>();
  for (let i = 0; i * p <= limit; i++) {
    const base = i * p;
    for (let j = 0; base + j * q <= limit; j++) set.add(base + j * q);
  }
  return [...set].sort((a, b) => a - b);
}

/** Index of the largest raster value ≤ v (raster[0] is always 0). */
function floorIndex(raster: number[], v: number): number {
  let lo = 0;
  let hi = raster.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (raster[mid]! <= v) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// Choice encoding per state: 0 = leaf A, 1 = leaf B, 2 = empty,
// k ≥ 3 even → vertical cut at X raster index (k-3)/2, odd → horizontal cut at Y index (k-4)/2.
const LEAF_A = 0;
const LEAF_B = 1;
const EMPTY = 2;

/**
 * Cost cap for the guillotine DP, in units of nx·ny·(nx+ny)/2 (≈ 0.67 ms per million on a
 * desktop, ~4× that on a phone). Above it we fall back to a cheaper two-level search,
 * which only affects stickers of roughly 5–13 mm and loses under 1 % there. This runs on the
 * client while typing AND on the server, so both must use the same cap (same result).
 */
export const DP_WORK_LIMIT = 50_000_000;

/**
 * The 5-block (pinwheel) pass costs ~(nx·ny)²/4 cheap lookups; it is run only up to this
 * many DP states (covers every sticker of about 20 mm and up, where it gains 1–3 cells).
 */
export const FIVE_BLOCK_STATE_LIMIT = 2_500;

/**
 * Best packing of inflated boxes `a` (upright) and `b` (turned) into W×H (inflated).
 * Returns null when nothing fits.
 */
export function packMixed(W: number, H: number, a: Box, b: Box): PackResult | null {
  const X = rasterPoints(W, a.w, b.w);
  const Y = rasterPoints(H, a.h, b.h);
  const nx = X.length;
  const ny = Y.length;
  const work = nx * ny * ((nx + ny) / 2);
  if (work > DP_WORK_LIMIT) return packTwoLevel(W, H, a, b);

  const val = new Int32Array(nx * ny);
  const choice = new Int32Array(nx * ny);
  // floorIndex of (X[i] - X[k]) for k ≤ i/2 is needed repeatedly; precompute per axis lazily.
  const fx = (v: number) => floorIndex(X, v);
  const fy = (v: number) => floorIndex(Y, v);
  const restX: Int32Array[] = new Array(nx);
  for (let i = 0; i < nx; i++) {
    const half = X[i]! / 2;
    const arr: number[] = [];
    for (let k = 1; k < nx && X[k]! <= half; k++) arr.push(k, fx(X[i]! - X[k]!));
    restX[i] = Int32Array.from(arr);
  }
  const restY: Int32Array[] = new Array(ny);
  for (let j = 0; j < ny; j++) {
    const half = Y[j]! / 2;
    const arr: number[] = [];
    for (let k = 1; k < ny && Y[k]! <= half; k++) arr.push(k, fy(Y[j]! - Y[k]!));
    restY[j] = Int32Array.from(arr);
  }

  for (let i = 0; i < nx; i++) {
    const x = X[i]!;
    for (let j = 0; j < ny; j++) {
      const y = Y[j]!;
      const ga = Math.floor(x / a.w) * Math.floor(y / a.h);
      const gb = Math.floor(x / b.w) * Math.floor(y / b.h);
      let best = 0;
      let ch = EMPTY;
      if (ga > 0 || gb > 0) {
        if (ga >= gb) {
          best = ga;
          ch = LEAF_A;
        } else {
          best = gb;
          ch = LEAF_B;
        }
      }
      const rx = restX[i]!;
      for (let t = 0; t < rx.length; t += 2) {
        const v = val[rx[t]! * ny + j]! + val[rx[t + 1]! * ny + j]!;
        if (v > best) {
          best = v;
          ch = 3 + 2 * rx[t]!;
        }
      }
      const ry = restY[j]!;
      for (let t = 0; t < ry.length; t += 2) {
        const v = val[i * ny + ry[t]!]! + val[i * ny + ry[t + 1]!]!;
        if (v > best) {
          best = v;
          ch = 4 + 2 * ry[t]!;
        }
      }
      val[i * ny + j] = best;
      choice[i * ny + j] = ch;
    }
  }

  const V = (i: number, j: number) => val[i * ny + j]!;
  let top = V(nx - 1, ny - 1);

  // Non-guillotine "pinwheel" (first-order 5-block): x1 < x2 on X, y1 < y2 on Y split the
  // sheet into five rectangles that tile it exactly; each is filled by the guillotine table.
  //   [0,0,x2,y1]  [x2,0,W-x2,y2]  [x1,y2,W-x1,H-y2]  [0,y1,x1,H-y1]  centre [x1,y1,x2-x1,y2-y1]
  // Only taken when STRICTLY better than the guillotine optimum.
  let five: [number, number, number, number] | null = null;
  if (nx * ny <= FIVE_BLOCK_STATE_LIMIT) {
    const restW = Int32Array.from(X, (x) => fx(W - x));
    const restH = Int32Array.from(Y, (y) => fy(H - y));
    for (let p = 1; p < nx; p++) {
      for (let q = p + 1; q < nx; q++) {
        const dx = fx(X[q]! - X[p]!);
        for (let c = 1; c < ny; c++) {
          const b1 = V(q, c);
          const b4 = V(p, restH[c]!);
          for (let d = c + 1; d < ny; d++) {
            const v = b1 + b4 + V(restW[q]!, d) + V(restW[p]!, restH[d]!) + V(dx, fy(Y[d]! - Y[c]!));
            if (v > top) {
              top = v;
              five = [p, q, c, d];
            }
          }
        }
      }
    }
  }
  if (top === 0) return null;

  const cells: PackedCell[] = [];
  let main = { o: 0 as 0 | 1, cols: 0, rows: 0 };
  /** Emit the cells of DP state (i, j) placed at (ox, oy). Explicit stack, no recursion. */
  const emit = (i0: number, j0: number, ox0: number, oy0: number) => {
    const stack: [number, number, number, number][] = [[i0, j0, ox0, oy0]];
    while (stack.length) {
      const [i, j, ox, oy] = stack.pop()!;
      const ch = choice[i * ny + j]!;
      const x = X[i]!;
      const y = Y[j]!;
      if (ch === EMPTY) continue;
      if (ch === LEAF_A || ch === LEAF_B) {
        const box = ch === LEAF_A ? a : b;
        const cols = Math.floor(x / box.w);
        const rows = Math.floor(y / box.h);
        if (cols * rows > main.cols * main.rows) main = { o: ch as 0 | 1, cols, rows };
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) cells.push({ x: ox + c * box.w, y: oy + r * box.h, o: ch as 0 | 1 });
        }
        continue;
      }
      if ((ch - 3) % 2 === 0) {
        const k = (ch - 3) / 2;
        const rest = fx(x - X[k]!);
        stack.push([rest, j, ox + X[k]!, oy], [k, j, ox, oy]);
      } else {
        const k = (ch - 4) / 2;
        const rest = fy(y - Y[k]!);
        stack.push([i, rest, ox, oy + Y[k]!], [i, k, ox, oy]);
      }
    }
  };
  if (five) {
    const [p, q, c, d] = five;
    const x1 = X[p]!;
    const x2 = X[q]!;
    const y1 = Y[c]!;
    const y2 = Y[d]!;
    emit(q, c, 0, 0);
    emit(fx(W - x2), d, x2, 0);
    emit(fx(W - x1), fy(H - y2), x1, y2);
    emit(p, fy(H - y1), 0, y1);
    emit(fx(x2 - x1), fy(y2 - y1), x1, y1);
  } else {
    emit(nx - 1, ny - 1, 0, 0);
  }
  return { count: top, cells, main };
}

/**
 * Fallback for very small stickers (huge raster): best of "grid of one orientation +
 * best grid of either orientation in the leftover strip", for vertical and horizontal
 * splits at every block boundary. Fast (O(cols + rows)) and never worse than a grid.
 */
export function packTwoLevel(W: number, H: number, a: Box, b: Box): PackResult | null {
  const grid = (w: number, h: number, box: Box) => Math.floor(w / box.w) * Math.floor(h / box.h);
  const bestGrid = (w: number, h: number): { n: number; o: 0 | 1 } => {
    const na = grid(w, h, a);
    const nb = grid(w, h, b);
    return na >= nb ? { n: na, o: 0 } : { n: nb, o: 1 };
  };
  type Plan = { n: number; build: () => PackedCell[]; main: PackResult['main'] };
  const fill = (w: number, h: number, o: 0 | 1, ox: number, oy: number): PackedCell[] => {
    const box = o === 0 ? a : b;
    const cols = Math.floor(w / box.w);
    const rows = Math.floor(h / box.h);
    const out: PackedCell[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: ox + c * box.w, y: oy + r * box.h, o });
    return out;
  };
  const whole = bestGrid(W, H);
  const wholeBox = whole.o === 0 ? a : b;
  let best: Plan = {
    n: whole.n,
    build: () => fill(W, H, whole.o, 0, 0),
    main: { o: whole.o, cols: Math.floor(W / wholeBox.w), rows: Math.floor(H / wholeBox.h) },
  };
  for (const o of [0, 1] as const) {
    const box = o === 0 ? a : b;
    const maxRows = Math.floor(H / box.h);
    const maxCols = Math.floor(W / box.w);
    // Vertical split: k columns of `o` on the left, best grid on the right strip.
    for (let k = 1; k <= maxCols; k++) {
      const leftW = k * box.w;
      const right = bestGrid(W - leftW, H);
      const n = k * maxRows + right.n;
      if (n > best.n) {
        best = {
          n,
          build: () => [...fill(leftW, H, o, 0, 0), ...fill(W - leftW, H, right.o, leftW, 0)],
          main: { o, cols: k, rows: maxRows },
        };
      }
    }
    // Horizontal split: k rows of `o` on top, best grid below.
    for (let k = 1; k <= maxRows; k++) {
      const topH = k * box.h;
      const below = bestGrid(W, H - topH);
      const n = maxCols * k + below.n;
      if (n > best.n) {
        best = {
          n,
          build: () => [...fill(W, topH, o, 0, 0), ...fill(W, H - topH, below.o, 0, topH)],
          main: { o, cols: maxCols, rows: k },
        };
      }
    }
  }
  if (best.n === 0) return null;
  return { count: best.n, cells: best.build(), main: best.main };
}
