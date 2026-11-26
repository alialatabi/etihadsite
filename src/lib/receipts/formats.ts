/**
 * Receipt-book formats (الوصولات) imposed on one A4 page. PURE and client-safe: the table, the
 * auto-turn / white-side rules and the format guess for an uploaded file. The numbers are the
 * owner's written sizes (spec docs/superpowers/specs/2026-11-26-staff-original-art-and-receipts.md,
 * B1/B2); every length is an integer number of micrometres, page origin TOP-LEFT, A4 portrait
 * 210 000 x 297 000 µm (A4_UM). A test pins every number.
 */
import { A4_UM, ptToUm } from '@/lib/units';
import type { DesignSource } from '@/lib/types';

export type ReceiptFormat = 'a4' | 'a5' | 'a6' | 'dl';
export const RECEIPT_FORMAT_IDS: readonly ReceiptFormat[] = ['a4', 'a5', 'a6', 'dl'];

/** Where the white strip (hole punch and binding) of an A6 quarter is. Other formats have a fixed side. */
export type ReceiptWhite = 'top' | 'bottom';

/** Rotation in degrees, clockwise. */
export type ReceiptTurn = 0 | 90 | 180 | 270;

export interface ReceiptSlot {
  xUm: number;
  /** From the TOP of the page. */
  yUm: number;
  widthUm: number;
  heightUm: number;
}

export interface ReceiptFormatInfo {
  /** Receipts per A4 sheet. */
  perSheet: number;
  /** Size of one slot. */
  widthUm: number;
  heightUm: number;
}

export const RECEIPT_FORMATS: Readonly<Record<ReceiptFormat, ReceiptFormatInfo>> = {
  a4: { perSheet: 1, widthUm: 210_000, heightUm: 285_000 },
  a5: { perSheet: 2, widthUm: 195_000, heightUm: 144_500 },
  dl: { perSheet: 3, widthUm: 195_000, heightUm: 93_666 },
  a6: { perSheet: 4, widthUm: 101_390, heightUm: 141_320 },
};

/** The grid of one sheet: columns x rows of receipts. */
export const RECEIPT_GRID: Readonly<Record<ReceiptFormat, { cols: number; rows: number }>> = {
  a4: { cols: 1, rows: 1 },
  a5: { cols: 1, rows: 2 },
  dl: { cols: 1, rows: 3 },
  a6: { cols: 2, rows: 2 },
};

/**
 * The white around and between the receipts on the A4 page, in integer µm. top / right / bottom /
 * left are the PHYSICAL sides of the page (page origin top-left, whatever the reading direction).
 * `gapXUm` only applies with more than one column (A6), `gapYUm` with more than one row (A5, DL, A6);
 * a gap that does not apply is ignored by `receiptSlots` but kept in the object.
 */
export interface ReceiptSpacing {
  topUm: number;
  rightUm: number;
  bottomUm: number;
  leftUm: number;
  gapXUm: number;
  gapYUm: number;
}
export type ReceiptSpacingKey = keyof ReceiptSpacing;
export const RECEIPT_SPACING_KEYS: readonly ReceiptSpacingKey[] = ['topUm', 'bottomUm', 'rightUm', 'leftUm', 'gapXUm', 'gapYUm'];

/** Each spacing value is 0..100 mm. */
export const MAX_SPACING_UM = 100_000;
/** A slot narrower or shorter than 20 mm means there is no room for the design. */
export const MIN_SLOT_UM = 20_000;

/** The owner's written spacing (spec B1/B2). `white` only matters for A6 (which side the 7 mm strip is on). */
export function defaultSpacing(format: ReceiptFormat, white: ReceiptWhite = 'top'): ReceiptSpacing {
  switch (format) {
    case 'a4':
      return { topUm: 12_000, rightUm: 0, bottomUm: 0, leftUm: 0, gapXUm: 0, gapYUm: 0 };
    case 'a5':
    case 'dl':
      // 15 mm white on the left, 8 mm between the receipts (DL: the 2 leftover µm go to the first gaps).
      return { topUm: 0, rightUm: 0, bottomUm: 0, leftUm: 15_000, gapXUm: 0, gapYUm: 8_000 };
    case 'a6':
      // 7 mm of white per quarter at the top or the bottom, 7.22 mm between the columns, 7.36 mm between the rows.
      return { topUm: white === 'top' ? 7_000 : 0, rightUm: 0, bottomUm: white === 'top' ? 0 : 7_000, leftUm: 0, gapXUm: 7_220, gapYUm: 7_360 };
  }
}

/** Top and bottom margins swapped: the A6 white strip moved to the other side. */
export function swapWhiteSpacing(s: ReceiptSpacing): ReceiptSpacing {
  return { ...s, topUm: s.bottomUm, bottomUm: s.topUm };
}

/** Start of each of `n` cells along an axis of length `length`, and the cell size (the leftover µm go to the first gaps). */
function axis(n: number, length: number, start: number, end: number, gap: number): { cell: number; starts: number[] } {
  const avail = length - start - end - (n - 1) * gap;
  const cell = Math.floor(avail / n);
  const left = avail - n * cell; // 0 <= left < n
  return { cell, starts: Array.from({ length: n }, (_, i) => start + i * cell + i * gap + Math.min(i, left)) };
}

/** The slots of one sheet, in reading order (top to bottom; A6 row by row). */
export function receiptSlots(format: ReceiptFormat, spacing: ReceiptSpacing): ReceiptSlot[] {
  const { cols, rows } = RECEIPT_GRID[format];
  const x = axis(cols, A4_UM.widthUm, spacing.leftUm, spacing.rightUm, spacing.gapXUm);
  const y = axis(rows, A4_UM.heightUm, spacing.topUm, spacing.bottomUm, spacing.gapYUm);
  return y.starts.flatMap((yUm) => x.starts.map((xUm) => ({ xUm, yUm, widthUm: x.cell, heightUm: y.cell })));
}

/** Every value a whole number of µm in 0..100 mm, and every slot at least 20 mm wide and tall. */
export function spacingFits(format: ReceiptFormat, spacing: ReceiptSpacing): boolean {
  for (const k of RECEIPT_SPACING_KEYS) {
    const v = spacing[k];
    if (!Number.isInteger(v) || v < 0 || v > MAX_SPACING_UM) return false;
  }
  const [slot] = receiptSlots(format, spacing);
  return slot.widthUm >= MIN_SLOT_UM && slot.heightUm >= MIN_SLOT_UM;
}

/** A slot wider than tall (a5, dl); a4 and a6 are portrait. */
export function slotIsLandscape(format: ReceiptFormat): boolean {
  const { widthUm, heightUm } = RECEIPT_FORMATS[format];
  return widthUm > heightUm;
}

type Dims = Pick<DesignSource, 'pxWidth' | 'pxHeight'>;

/**
 * 0 when the design's displayed orientation matches the slot's, else 270 (a quarter turn
 * counter-clockwise: the design's top edge goes to the page's left, as in the owner's samples).
 * A square design counts as portrait.
 */
export function autoTurn(format: ReceiptFormat, design: Dims): ReceiptTurn {
  const landscape = design.pxWidth > design.pxHeight;
  return landscape === slotIsLandscape(format) ? 0 : 270;
}

/** The white strip of an A6 quarter: top for an upright design, bottom for one turned 90/270. */
export function autoWhite(turn: ReceiptTurn): ReceiptWhite {
  return turn === 90 || turn === 270 ? 'bottom' : 'top';
}

/** One more quarter turn clockwise. */
export function nextTurn(turn: ReceiptTurn): ReceiptTurn {
  return ((turn + 90) % 360) as ReceiptTurn;
}

/* ───────────────────────────────── format guess ───────────────────────────────── */

/** A format token standing alone in the name: not inside a longer Latin word or number (`a55`, `data5`). */
const NAME_TOKEN = /(?<![A-Za-z0-9])(a4|a5|a6|dl)(?![A-Za-z0-9])/i;

/** Nominal physical sizes in µm, short side first. A4 appears twice (21 x 28.5 and 21 x 29.7). */
const NOMINAL_UM: readonly { format: ReceiptFormat; short: number; long: number }[] = [
  { format: 'a4', short: 210_000, long: 285_000 },
  { format: 'a4', short: 210_000, long: 297_000 },
  { format: 'a5', short: 150_000, long: 195_000 },
  { format: 'a6', short: 100_000, long: 150_000 },
  { format: 'dl', short: 100_000, long: 195_000 },
];
const PDF_TOLERANCE = 0.15;
const NOMINAL_ASPECT: readonly { format: ReceiptFormat; aspect: number }[] = [
  { format: 'a4', aspect: 1.357 },
  { format: 'a5', aspect: 1.3 },
  { format: 'a6', aspect: 1.5 },
  { format: 'dl', aspect: 1.95 },
];

/**
 * The format a file most likely is: (1) a format token in the file name, else (2) a PDF's physical
 * page size within 15 % of a nominal size, else (3) the aspect ratio nearest to a format's, else A4.
 * Only a first guess: the employee can change it.
 */
export function guessReceiptFormat(fileName: string, design: Pick<DesignSource, 'pxWidth' | 'pxHeight' | 'pdf'>): ReceiptFormat {
  const m = NAME_TOKEN.exec(fileName);
  if (m) return m[1].toLowerCase() as ReceiptFormat;

  if (design.pdf) {
    const a = ptToUm(design.pdf.pageWidthPt);
    const b = ptToUm(design.pdf.pageHeightPt);
    const short = Math.min(a, b);
    const long = Math.max(a, b);
    if (short > 0 && long > 0) {
      let best: { format: ReceiptFormat; off: number } | null = null;
      for (const n of NOMINAL_UM) {
        const off = Math.max(Math.abs(short - n.short) / n.short, Math.abs(long - n.long) / n.long);
        if (off <= PDF_TOLERANCE && (!best || off < best.off)) best = { format: n.format, off };
      }
      if (best) return best.format;
    }
  }

  const { pxWidth: w, pxHeight: h } = design;
  if (w > 0 && h > 0) {
    const aspect = Math.max(w, h) / Math.min(w, h);
    let best = NOMINAL_ASPECT[0];
    for (const n of NOMINAL_ASPECT) if (Math.abs(n.aspect - aspect) < Math.abs(best.aspect - aspect)) best = n;
    return best.format;
  }
  return 'a4';
}
