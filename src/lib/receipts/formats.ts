/**
 * Receipt-book formats (الوصولات) imposed on one A4 page. PURE and client-safe: the table, the
 * auto-turn / white-side rules and the format guess for an uploaded file. The numbers are the
 * owner's written sizes (spec docs/superpowers/specs/2026-11-26-staff-original-art-and-receipts.md,
 * B1/B2); every length is an integer number of micrometres, page origin TOP-LEFT, A4 portrait
 * 210 000 x 297 000 µm (A4_UM). A test pins every number.
 */
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

/** The slots of one sheet, in reading order (top to bottom; A6 row by row). `white` only matters for A6. */
export function receiptSlots(format: ReceiptFormat, white: ReceiptWhite = 'top'): ReceiptSlot[] {
  const { widthUm, heightUm } = RECEIPT_FORMATS[format];
  switch (format) {
    case 'a4':
      return [{ xUm: 0, yUm: 12_000, widthUm, heightUm }];
    case 'a5':
      // 15 mm white on the left, 8 mm between the two.
      return [0, 152_500].map((yUm) => ({ xUm: 15_000, yUm, widthUm, heightUm }));
    case 'dl':
      // 15 mm white on the left, about 8 mm between the three.
      return [0, 101_667, 203_334].map((yUm) => ({ xUm: 15_000, yUm, widthUm, heightUm }));
    case 'a6': {
      // 7 mm of white per quarter at the top or the bottom, 7.22 mm between the two columns.
      const rows = white === 'top' ? [7_000, 155_680] : [0, 148_680];
      return rows.flatMap((yUm) => [0, 108_610].map((xUm) => ({ xUm, yUm, widthUm, heightUm })));
    }
  }
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

/** Nominal physical sizes in mm, short side first. A4 appears twice (21 x 28.5 and 21 x 29.7). */
const NOMINAL_MM: readonly { format: ReceiptFormat; short: number; long: number }[] = [
  { format: 'a4', short: 210, long: 285 },
  { format: 'a4', short: 210, long: 297 },
  { format: 'a5', short: 150, long: 195 },
  { format: 'a6', short: 100, long: 150 },
  { format: 'dl', short: 100, long: 195 },
];
const PDF_TOLERANCE = 0.15;
const NOMINAL_ASPECT: readonly { format: ReceiptFormat; aspect: number }[] = [
  { format: 'a4', aspect: 1.357 },
  { format: 'a5', aspect: 1.3 },
  { format: 'a6', aspect: 1.5 },
  { format: 'dl', aspect: 1.95 },
];
const MM_PER_PT = 25.4 / 72;

/**
 * The format a file most likely is: (1) a format token in the file name, else (2) a PDF's physical
 * page size within 15 % of a nominal size, else (3) the aspect ratio nearest to a format's, else A4.
 * Only a first guess: the employee can change it.
 */
export function guessReceiptFormat(fileName: string, design: Pick<DesignSource, 'pxWidth' | 'pxHeight' | 'pdf'>): ReceiptFormat {
  const m = NAME_TOKEN.exec(fileName);
  if (m) return m[1].toLowerCase() as ReceiptFormat;

  if (design.pdf) {
    const a = design.pdf.pageWidthPt * MM_PER_PT;
    const b = design.pdf.pageHeightPt * MM_PER_PT;
    const short = Math.min(a, b);
    const long = Math.max(a, b);
    if (short > 0 && long > 0) {
      let best: { format: ReceiptFormat; off: number } | null = null;
      for (const n of NOMINAL_MM) {
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
