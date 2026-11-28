/**
 * How much text fits on a sticker at the minimum legible size. Pure and browser-safe
 * (no `server-only`, no Node APIs): the builder UI and the server both use it.
 * Units are integer micrometres.
 */
import type { Shape } from '../types';
import { AI_MAX_ASPECT } from './config';

/** 12 pt in micrometres. */
export const PT12_EM_UM = 4233;
export const LINE_PITCH_EM = 1.4;
export const GLYPH_ADVANCE_EM = 0.55;
/** Share of the usable height the text block may take; calibrated on spike images a (passes at 5 cm) and c (fails at 3 cm). */
export const TEXT_HEIGHT_SHARE = 0.65;

/** Widest sticker the shop prints (204 mm). */
const MAX_WIDTH_UM = 204_000;
const STEP_UM = 1_000;

export interface TextCapacity {
  ok: boolean;
  rowsNeeded: number;
  rowsAllowed: number;
  minSizeUm: number | null;
}

/**
 * The box (µm) inside the sticker that text may use. A rectangle longer than AI_MAX_ASPECT : 1 is drawn by the
 * model on an AI_MAX_ASPECT : 1 canvas (the two short ends are only extended afterwards), so its long side is
 * measured at that canvas, not at the full sticker.
 */
export function usableBoxUm(shape: Shape, widthUm: number, heightUm: number): { w: number; h: number } {
  if (shape === 'circle') {
    const d = Math.min(widthUm, heightUm);
    const side = 0.7 * d * 0.92;
    return { w: side, h: side };
  }
  if (shape === 'rect') {
    const w = Math.min(widthUm, AI_MAX_ASPECT * heightUm);
    const h = Math.min(heightUm, AI_MAX_ASPECT * widthUm);
    return { w: 0.9 * w, h: 0.9 * h };
  }
  return { w: 0.8 * widthUm, h: 0.8 * heightUm };
}

/** Code points excluding combining marks (Arabic tanween, harakat), after trim. */
function charCount(line: string): number {
  let n = 0;
  for (const ch of line.trim()) {
    if (!/\p{M}/u.test(ch)) n += 1;
  }
  return n;
}

function evaluate(lines: string[], shape: Shape, widthUm: number, heightUm: number) {
  const usable = usableBoxUm(shape, widthUm, heightUm);
  let rowsNeeded = 0;
  for (const line of lines) {
    const chars = charCount(line);
    if (chars === 0) continue;
    rowsNeeded += Math.ceil((chars * GLYPH_ADVANCE_EM * PT12_EM_UM) / usable.w);
  }
  const rowsAllowed = Math.floor((TEXT_HEIGHT_SHARE * usable.h) / (LINE_PITCH_EM * PT12_EM_UM));
  return { rowsNeeded, rowsAllowed, ok: rowsNeeded <= rowsAllowed };
}

export function textCapacity(
  lines: string[],
  shape: Shape,
  widthUm: number,
  heightUm: number,
): TextCapacity {
  const { rowsNeeded, rowsAllowed, ok } = evaluate(lines, shape, widthUm, heightUm);
  if (ok) return { ok, rowsNeeded, rowsAllowed, minSizeUm: null };

  // Smallest width (aspect kept) that fits, in 1,000 µm steps.
  let minSizeUm: number | null = null;
  const start = Math.floor(widthUm / STEP_UM) * STEP_UM + STEP_UM;
  for (let w = start; w <= MAX_WIDTH_UM; w += STEP_UM) {
    const h = (heightUm * w) / widthUm;
    if (evaluate(lines, shape, w, h).ok) {
      minSizeUm = w;
      break;
    }
  }
  return { ok, rowsNeeded, rowsAllowed, minSizeUm };
}
