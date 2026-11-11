/**
 * One A4 sticker sheet page, drawn into a pdf-lib document. ISOMORPHIC: no `server-only`, no
 * `node:` APIs. The customer order PDF (build-sheet.ts, server) and the staff page's
 * multi-page PDF (build-staff-pdf.ts, browser) both draw their pages here.
 *
 * Per page: the artwork embedded ONCE and drawn countPerSheet times with raw operators, one
 * `q … Q` pair per cell: `q [<clip path> W n] a b c d e f cm /Name Do Q` (the clip path only
 * when a clip applies), then, when `layout.marks` is present, the 4 camera-cutter dots. No text
 * and no cut lines: the cutter's camera reads the printed paper (design 2026-11-12, D6).
 *
 * Orientation conventions (the on-screen preview must match):
 *  - PDF artwork: embedPage ignores /Rotate, so we apply artwork.rotate
 *    clockwise ourselves.
 *  - Rotated layouts (layout.rotated): the artwork is turned 90 degrees
 *    CLOCKWISE (CSS rotate(90deg)) about the cell centre to fill the swapped cell.
 *  - Mixed layouts: placements with `turned` use the cell swapped and flip that
 *    decision (art turned iff layout.rotated XOR placement.turned).
 *  - Artwork is scaled to COVER the cell and centred; the overflow is hidden by the clip.
 *    Clips: circle → the inscribed circle (centre crop); roundedRect → the cell's rounded
 *    rectangle (radius from the layout, at most half the shorter side), because the camera cuts
 *    what is printed; none → a plain rectangle only when the artwork aspect differs from the cell's.
 *
 * Dots (copied from the shop's hand-made CorelDRAW sheet, design A3): one path of 4 circles
 * (4 Bezier quarters each) filled even-odd in DeviceCMYK 0 0 0 1, inside the optional-content
 * layer named `sk_marks` (`/OC /<prop> BDC … EMC`), listed in the catalog's /OCProperties as
 * visible. The layer dictionary is created once per document and mapped in each page's
 * /Resources /Properties.
 */
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFRef,
  PDFString,
  PrintScaling,
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  drawObject,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingCmykColor,
  type PDFPage,
} from 'pdf-lib';
import { cellSizeFor } from '@/lib/layout';
import { A4_PT, umToPt } from '@/lib/units';
import type { LayoutResult, NormalisedArtwork } from '@/lib/types';

/** Producer and creator stamped into every sheet PDF. */
export const PDF_PRODUCER = 'Softy Printing';

/** Name of the optional-content layer holding the cutter dots (the plotter plug-in's name). */
export const MARKS_LAYER_NAME = 'sk_marks';
/** Key of the dots layer in each page's /Resources /Properties. */
const MARKS_PROPERTY = 'SkMarks';

/** Control-point distance, as a fraction of the radius, for a cubic Bezier quarter circle. */
const BEZIER_CIRCLE_KAPPA = 0.5522847498;
/** Cover-scaled artwork may overflow its cell by this fraction before a rectangle clip is added. */
const COVER_OVERFLOW_TOLERANCE = 0.002;

function circlePath(cx: number, cy: number, r: number): PDFOperator[] {
  const c = BEZIER_CIRCLE_KAPPA * r;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r),
    appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
    appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r),
    appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy),
    closePath(),
  ];
}

function rectPath(x: number, y: number, w: number, h: number): PDFOperator[] {
  return [moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath()];
}

/** Rectangle with quarter-circle corners of radius `r` (0 < r ≤ min(w, h) / 2), counter-clockwise from the bottom edge. */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number): PDFOperator[] {
  const c = BEZIER_CIRCLE_KAPPA * r;
  const right = x + w;
  const top = y + h;
  return [
    moveTo(x + r, y),
    lineTo(right - r, y),
    appendBezierCurve(right - r + c, y, right, y + r - c, right, y + r),
    lineTo(right, top - r),
    appendBezierCurve(right, top - r + c, right - r + c, top, right - r, top),
    lineTo(x + r, top),
    appendBezierCurve(x + r - c, top, x, top - r + c, x, top - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - c, x + r - c, y, x + r, y),
    closePath(),
  ];
}

interface EmbeddedArtwork {
  xobjectName: PDFName;
  bw: number;
  bh: number;
  isImage: boolean;
  /** Clockwise /Rotate of the source PDF page (embedPage ignores it); 0 for images. */
  pageRotateCw: number;
}

/**
 * Embed once. `bw x bh` is the native size of the embedded object in its own space
 * (images: pixels mapped from the unit square; forms: the box in points, origin 0,0).
 */
async function embedArtwork(doc: PDFDocument, page: PDFPage, artwork: NormalisedArtwork): Promise<EmbeddedArtwork> {
  if (artwork.kind === 'raster') {
    const image = artwork.mime === 'image/png' ? await doc.embedPng(artwork.bytes) : await doc.embedJpg(artwork.bytes);
    const xobjectName = page.node.newXObject('Image', image.ref);
    return { xobjectName, bw: artwork.pxWidth, bh: artwork.pxHeight, isImage: true, pageRotateCw: 0 };
  }
  const src = await PDFDocument.load(artwork.bytes);
  const srcPage = src.getPage(0);
  const { x, y, width, height } = artwork.box;
  const embedded = await doc.embedPage(srcPage, { left: x, bottom: y, right: x + width, top: y + height });
  const xobjectName = page.node.newXObject('EmbeddedPdfPage', embedded.ref);
  return { xobjectName, bw: width, bh: height, isImage: false, pageRotateCw: artwork.rotate };
}

/** The `sk_marks` layer of each document, created on first use. */
const marksLayers = new WeakMap<PDFDocument, PDFRef>();

function marksLayer(doc: PDFDocument): PDFRef {
  const existing = marksLayers.get(doc);
  if (existing) return existing;
  const ctx = doc.context;
  const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(MARKS_LAYER_NAME) }));
  doc.catalog.set(
    PDFName.of('OCProperties'),
    ctx.obj({ OCGs: [ref], D: { Order: [ref], ON: [ref] } }),
  );
  marksLayers.set(doc, ref);
  return ref;
}

/** The 4 dots as one even-odd filled path, K black, inside the `sk_marks` layer. */
function marksOperators(doc: PDFDocument, page: PDFPage, marks: NonNullable<LayoutResult['marks']>, pageH: number): PDFOperator[] {
  const layer = marksLayer(doc);
  const resources = page.node.normalizedEntries().Resources;
  resources.set(PDFName.of('Properties'), doc.context.obj({ [MARKS_PROPERTY]: layer }));
  const r = umToPt(marks.diameterUm) / 2;
  return [
    pushGraphicsState(),
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(MARKS_PROPERTY)]),
    setFillingCmykColor(0, 0, 0, 1),
    ...marks.centres.flatMap((c) => circlePath(umToPt(c.xUm), pageH - umToPt(c.yUm), r)),
    PDFOperator.of(PDFOperatorNames.FillEvenOdd),
    PDFOperator.of(PDFOperatorNames.EndMarkedContent),
    popGraphicsState(),
  ];
}

/**
 * Add one A4 page to `doc` with `layout`'s stickers (artwork embedded once) and, when the
 * layout carries `marks`, the cutter dots. `drawCount` counts artwork draws only (the dots are
 * paths), so it equals layout.countPerSheet.
 */
export async function drawSheetPage(
  doc: PDFDocument,
  layout: LayoutResult,
  artwork: NormalisedArtwork,
): Promise<{ drawCount: number; placementsPt: { x: number; y: number; w: number; h: number }[]; clipped: boolean }> {
  const pageW = A4_PT.widthPt;
  const pageH = A4_PT.heightPt;
  const page: PDFPage = doc.addPage([pageW, pageH]);

  const { xobjectName, bw, bh, isImage, pageRotateCw } = await embedArtwork(doc, page, artwork);

  const clipKind = layout.clip.kind === 'roundedRect' && layout.clip.radiusUm <= 0 ? 'none' : layout.clip.kind;
  const radiusPt = layout.clip.kind === 'roundedRect' ? umToPt(layout.clip.radiusUm) : 0;

  /**
   * Drawing parameters for one orientation. `turned` cells (mixed layouts) use the cell
   * swapped and the artwork turned a further 90° clockwise, so both variants are derived
   * from the same rule and every sticker prints the same way up relative to its cell.
   */
  const variant = (turned: boolean) => {
    const artRotated = layout.rotated !== turned;
    const phi = (((pageRotateCw + (artRotated ? 90 : 0)) % 360) + 360) % 360;
    const rad = (phi * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad)); // phi is a multiple of 90
    const swap = phi === 90 || phi === 270;
    const dispW = swap ? bh : bw;
    const dispH = swap ? bw : bh;
    const cellUm = cellSizeFor(layout, turned);
    const cellW = umToPt(cellUm.widthUm);
    const cellH = umToPt(cellUm.heightUm);
    const cover = Math.max(cellW / dispW, cellH / dispH);
    const overflow = Math.max((dispW * cover) / cellW, (dispH * cover) / cellH) - 1;
    const extraRectClip = clipKind === 'none' && overflow > COVER_OVERFLOW_TOLERANCE;
    const cornerPt = Math.min(radiusPt, Math.min(cellW, cellH) / 2);
    return { cos, sin, cellHeightUm: cellUm.heightUm, cellW, cellH, cover, extraRectClip, cornerPt };
  };
  const variants = { upright: variant(false), turned: variant(true) };

  const placementsPt: { x: number; y: number; w: number; h: number }[] = [];
  let drawCount = 0;
  let clipped = false;

  for (const p of layout.placements) {
    const { cos, sin, cellHeightUm, cellW, cellH, cover, extraRectClip, cornerPt } = p.turned ? variants.turned : variants.upright;
    const x = umToPt(p.xUm);
    const y = pageH - umToPt(p.yUm + cellHeightUm);
    placementsPt.push({ x, y, w: cellW, h: cellH });
    const cx = x + cellW / 2;
    const cy = y + cellH / 2;

    // Clockwise rotation by phi in y-up space = CCW by -phi: [cos, -sin, sin, cos].
    const a = cos * cover;
    const b = -sin * cover;
    const c = sin * cover;
    const d = cos * cover;
    const e = cx - (a * (bw / 2) + c * (bh / 2));
    const f = cy - (b * (bw / 2) + d * (bh / 2));
    // Images map the unit square to pixels, so fold the native size into the matrix.
    const m = isImage ? [a * bw, b * bw, c * bh, d * bh, e, f] : [a, b, c, d, e, f];

    const ops: PDFOperator[] = [pushGraphicsState()];
    if (clipKind === 'circle') {
      ops.push(...circlePath(cx, cy, Math.min(cellW, cellH) / 2), clip(), endPath());
      clipped = true;
    } else if (clipKind === 'roundedRect') {
      ops.push(...roundedRectPath(x, y, cellW, cellH, cornerPt), clip(), endPath());
      clipped = true;
    } else if (extraRectClip) {
      ops.push(...rectPath(x, y, cellW, cellH), clip(), endPath());
      clipped = true;
    }
    ops.push(concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(xobjectName), popGraphicsState());
    page.pushOperators(...ops);
    drawCount++;
  }

  if (layout.marks) page.pushOperators(...marksOperators(doc, page, layout.marks, pageH));

  return { drawCount, placementsPt, clipped };
}

/** Ask PDF viewers to print at 100 %: "fit to page" would shrink the dots off the plotter's template. */
export function setPrintAtActualSize(doc: PDFDocument): void {
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
}
