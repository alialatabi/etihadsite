/**
 * The 4 black dots the camera cutter uses to find the sheet (one in each page corner), and the
 * "near a dot" test the layout engine uses to keep stickers clear of them. Pure, isomorphic.
 *
 * Fixed by the owner (2026-11-12, design A1), not a setting: the plotter's dot template is
 * a 5 mm dot whose centre is 7 mm from both nearest edges, and no printed part of a sticker
 * may come within 3 mm of a dot's edge (keep-out radius 2.5 + 3 = 5.5 mm around each centre).
 *
 * Integer µm only. Distances are compared squared, in DOUBLED coordinates, so an odd diameter
 * (a half µm radius) stays exact.
 */
import { A4_UM } from '@/lib/units';
import type { ClipShape, RegMarks } from '@/lib/types';

export const REG_MARKS: RegMarks = { offsetUm: 7_000, diameterUm: 5_000, clearanceUm: 3_000 };

/** Dot centres on A4, in this order: top-left, top-right, bottom-left, bottom-right. */
export function markCentres(m: RegMarks): { xUm: number; yUm: number }[] {
  const left = m.offsetUm;
  const right = A4_UM.widthUm - m.offsetUm;
  const top = m.offsetUm;
  const bottom = A4_UM.heightUm - m.offsetUm;
  return [
    { xUm: left, yUm: top },
    { xUm: right, yUm: top },
    { xUm: left, yUm: bottom },
    { xUm: right, yUm: bottom },
  ];
}

/**
 * Smallest distance from a page edge at which a sticker edge can never be near a dot:
 * offset + diameter/2 + clearance, rounded UP to a whole µm.
 */
export function markInsetUm(m: RegMarks): number {
  return m.offsetUm + Math.ceil((m.diameterUm + 2 * m.clearanceUm) / 2);
}

/**
 * Whether a sticker printed in `cell` comes closer than diameter/2 + clearance to the dot at
 * `centre` (exactly that distance is allowed). Clip `circle` prints the circle inscribed in the
 * cell; every other clip can print up to the cell's rectangle.
 */
export function isNearMark(
  cell: { xUm: number; yUm: number; widthUm: number; heightUm: number },
  clip: ClipShape,
  centre: { xUm: number; yUm: number },
  m: RegMarks,
): boolean {
  const keep2 = m.diameterUm + 2 * m.clearanceUm; // keep-out radius, doubled
  const px2 = 2 * centre.xUm;
  const py2 = 2 * centre.yUm;
  if (clip.kind === 'circle') {
    const dx2 = 2 * cell.xUm + cell.widthUm - px2;
    const dy2 = 2 * cell.yUm + cell.heightUm - py2;
    const reach2 = Math.min(cell.widthUm, cell.heightUm) + keep2; // cell radius + keep-out, doubled
    return dx2 * dx2 + dy2 * dy2 < reach2 * reach2;
  }
  const dx2 = Math.max(2 * cell.xUm - px2, 0, px2 - 2 * (cell.xUm + cell.widthUm));
  const dy2 = Math.max(2 * cell.yUm - py2, 0, py2 - 2 * (cell.yUm + cell.heightUm));
  return dx2 * dx2 + dy2 * dy2 < keep2 * keep2;
}
