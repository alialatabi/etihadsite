import 'server-only';
/**
 * A4 sheet PDF builder. Node only (pdf-lib).
 *
 * One A4 page, artwork embedded ONCE and drawn countPerSheet times with raw
 * operators, one `q … Q` pair per cell: `q [<clip path> W n] a b c d e f cm /Name Do Q`
 * (the clip path only when a clip applies). NO text, marks or cut lines.
 *
 * Orientation conventions (the on-screen preview must match):
 *  - PDF artwork: embedPage ignores /Rotate, so we apply artwork.rotate
 *    clockwise ourselves.
 *  - Rotated layouts (layout.rotated): the artwork is turned 90 degrees
 *    CLOCKWISE (CSS rotate(90deg)) about the cell centre to fill the swapped cell.
 *  - Mixed layouts: placements with `turned` use the cell swapped and flip that
 *    decision (art turned iff layout.rotated XOR placement.turned).
 *  - Artwork is scaled to COVER the cell and centred; the overflow is hidden by
 *    the clip (circle: centre crop). Clip is applied for circle only, and as a plain
 *    rectangle when the aspect differs from the cell's. roundedRect is NOT clipped in the
 *    PDF (rounded corners are preview-only; PLAN §2).
 */
import {
  PDFDocument,
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
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { cellSizeFor } from '@/lib/layout';
import { A4_PT, umToPt } from '@/lib/units';
import type { NormalisedArtwork, SheetPdfInput, SheetPdfOutput } from '@/lib/types';

/** Control-point distance, as a fraction of the radius, for a cubic Bezier quarter circle. */
const BEZIER_CIRCLE_KAPPA = 0.5522847498;
/** Cover-scaled artwork may overflow its cell by this fraction before a rectangle clip is added. */
const COVER_OVERFLOW_TOLERANCE = 0.002;
const PDF_PRODUCER = 'Softy Printing';

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

export async function buildSheetPdf(input: SheetPdfInput): Promise<SheetPdfOutput> {
  const { layout, artwork, meta } = input;
  const pageW = A4_PT.widthPt;
  const pageH = A4_PT.heightPt;

  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([pageW, pageH]);

  const { xobjectName, bw, bh, isImage, pageRotateCw } = await embedArtwork(doc, page, artwork);

  // PLAN §2: rounded corners are preview-only. In the print PDF a roundedRect is treated as
  // 'none' (unclipped art is free bleed under the manual cut); only the plain rectangle
  // cover-clip applies when the artwork aspect differs from the cell's.
  const clipKind = layout.clip.kind === 'circle' ? 'circle' : 'none';

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
    return { cos, sin, cellHeightUm: cellUm.heightUm, cellW, cellH, cover, extraRectClip };
  };
  const variants = { upright: variant(false), turned: variant(true) };

  const placementsPt: { x: number; y: number; w: number; h: number }[] = [];
  let drawCount = 0;
  let clipped = false;

  for (const p of layout.placements) {
    const { cos, sin, cellHeightUm, cellW, cellH, cover, extraRectClip } = p.turned ? variants.turned : variants.upright;
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
    } else if (extraRectClip) {
      ops.push(...rectPath(x, y, cellW, cellH), clip(), endPath());
      clipped = true;
    }
    ops.push(concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(xobjectName), popGraphicsState());
    page.pushOperators(...ops);
    drawCount++;
  }

  doc.setTitle(meta.displayNo);
  doc.setSubject(meta.description);
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  doc.setCreationDate(new Date());

  const bytes = await doc.save();
  return {
    bytes,
    report: { pageWidthPt: pageW, pageHeightPt: pageH, drawCount, placementsPt, clipped, bytes: bytes.byteLength },
  };
}
