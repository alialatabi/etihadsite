/**
 * Shared unit constants and conversions. Sizes typed by customers, the layout, the DPI check
 * and the PDF all go through these, so changing a constant or a rounding rule changes output.
 *
 * Every physical dimension in this codebase is an INTEGER number of
 * micrometres (µm) unless the name says otherwise (…Pt, …Cm, …Px).
 * 1 mm = 1000 µm. 1 cm = 10 000 µm. This avoids floating-point drift
 * (e.g. 2.3 cm × 10 = 23.000000000000004 mm) in floor() computations.
 */

export const UM_PER_MM = 1_000;
export const UM_PER_CM = 10_000;
export const UM_PER_INCH = 25_400;
export const PT_PER_INCH = 72;

/** ISO A4 in µm. */
export const A4_UM = { widthUm: 210_000, heightUm: 297_000 } as const;

/** A4 in PDF points (595.2756 × 841.8898). */
export const A4_PT = {
  widthPt: (A4_UM.widthUm / UM_PER_INCH) * PT_PER_INCH,
  heightPt: (A4_UM.heightUm / UM_PER_INCH) * PT_PER_INCH,
} as const;

export const mmToUm = (mm: number): number => Math.round(mm * UM_PER_MM);
export const cmToUm = (cm: number): number => Math.round(cm * UM_PER_CM);
export const umToMm = (um: number): number => um / UM_PER_MM;
export const umToCm = (um: number): number => um / UM_PER_CM;
export const umToPt = (um: number): number => (um / UM_PER_INCH) * PT_PER_INCH;
export const ptToUm = (pt: number): number => Math.round((pt / PT_PER_INCH) * UM_PER_INCH);
export const umToInch = (um: number): number => um / UM_PER_INCH;

/** Pixels needed to print `um` at `dpi`. */
export const pxForUmAtDpi = (um: number, dpi: number): number => Math.round(umToInch(um) * dpi);

/** Effective print resolution of `px` pixels spread over `um` micrometres. */
export const effectiveDpi = (px: number, um: number): number => (um <= 0 ? 0 : px / umToInch(um));
