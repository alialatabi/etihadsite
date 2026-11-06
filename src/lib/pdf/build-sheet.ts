import 'server-only';
/**
 * A4 sheet PDF builder. Node only (pdf-lib).
 *
 * One A4 page, artwork embedded ONCE and drawn countPerSheet times with raw
 * operators: `q <clip path> W n  q cm /Name Do Q  Q`. NO text, marks or cut lines.
 *
 * Orientation conventions (the on-screen preview must match):
 *  - PDF artwork: embedPage ignores /Rotate, so we apply artwork.rotate
 *    clockwise ourselves.
 *  - Rotated layouts (layout.rotated): the artwork is turned 90 degrees
 *    CLOCKWISE (CSS rotate(90deg)) about the cell centre to fill the swapped cell.
 *  - Artwork is scaled to COVER the cell and centred; the overflow is hidden by
 *    the clip (circle: centre crop). Clip is applied for circle / roundedRect, and
 *    also as a plain rectangle when the aspect differs from the cell's.
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
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import { A4_PT, umToPt } from '@/lib/units';
import type { SheetPdfInput, SheetPdfOutput } from '@/lib/types';

const K = 0.5522847498;

function circlePath(cx: number, cy: number, r: number): PDFOperator[] {
  const c = K * r;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + c, cx + c, cy + r, cx, cy + r),
    appendBezierCurve(cx - c, cy + r, cx - r, cy + c, cx - r, cy),
    appendBezierCurve(cx - r, cy - c, cx - c, cy - r, cx, cy - r),
    appendBezierCurve(cx + c, cy - r, cx + r, cy - c, cx + r, cy),
    closePath(),
  ];
}

function roundedRectPath(x: number, y: number, w: number, h: number, radius: number): PDFOperator[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath()];
  const c = K * r;
  const R = x + w;
  const T = y + h;
  return [
    moveTo(x + r, y),
    lineTo(R - r, y),
    appendBezierCurve(R - r + c, y, R, y + r - c, R, y + r),
    lineTo(R, T - r),
    appendBezierCurve(R, T - r + c, R - r + c, T, R - r, T),
    lineTo(x + r, T),
    appendBezierCurve(x + r - c, T, x, T - r + c, x, T - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - c, x + r - c, y, x + r, y),
    closePath(),
  ];
}

export async function buildSheetPdf(input: SheetPdfInput): Promise<SheetPdfOutput> {
  const { layout, artwork, meta } = input;
  const pageW = A4_PT.widthPt;
  const pageH = A4_PT.heightPt;

  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([pageW, pageH]);

  // Embed once. `bw x bh` is the native size of the embedded object in its own space
  // (images: pixels mapped from the unit square; forms: the box in points, origin 0,0).
  let xobjectName: ReturnType<typeof page.node.newXObject>;
  let bw: number;
  let bh: number;
  let isImage: boolean;
  let pageRotateCw = 0;
  if (artwork.kind === 'raster') {
    const image = artwork.mime === 'image/png' ? await doc.embedPng(artwork.bytes) : await doc.embedJpg(artwork.bytes);
    xobjectName = page.node.newXObject('Image', image.ref);
    bw = artwork.pxWidth;
    bh = artwork.pxHeight;
    isImage = true;
  } else {
    const src = await PDFDocument.load(artwork.bytes);
    const srcPage = src.getPage(0);
    const { x, y, width, height } = artwork.box;
    const embedded = await doc.embedPage(srcPage, { left: x, bottom: y, right: x + width, top: y + height });
    xobjectName = page.node.newXObject('EmbeddedPdfPage', embedded.ref);
    bw = width;
    bh = height;
    isImage = false;
    pageRotateCw = artwork.rotate;
  }

  const phi = (((pageRotateCw + (layout.rotated ? 90 : 0)) % 360) + 360) % 360;
  const rad = (phi * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad)); // phi is a multiple of 90
  const swap = phi === 90 || phi === 270;
  const dispW = swap ? bh : bw;
  const dispH = swap ? bw : bh;

  const cellW = umToPt(layout.cell.widthUm);
  const cellH = umToPt(layout.cell.heightUm);
  const cover = Math.max(cellW / dispW, cellH / dispH);
  const overflow = Math.max((dispW * cover) / cellW, (dispH * cover) / cellH) - 1;
  const clipKind = layout.clip.kind;
  const extraRectClip = clipKind === 'none' && overflow > 0.002;

  const placementsPt: { x: number; y: number; w: number; h: number }[] = [];
  let drawCount = 0;
  let clipped = false;

  for (const p of layout.placements) {
    const x = umToPt(p.xUm);
    const y = pageH - umToPt(p.yUm + layout.cell.heightUm);
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
      ops.push(...roundedRectPath(x, y, cellW, cellH, umToPt(layout.clip.radiusUm)), clip(), endPath());
      clipped = true;
    } else if (extraRectClip) {
      ops.push(...roundedRectPath(x, y, cellW, cellH, 0), clip(), endPath());
      clipped = true;
    }
    ops.push(concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]), drawObject(xobjectName), popGraphicsState());
    page.pushOperators(...ops);
    drawCount++;
  }

  doc.setTitle(meta.displayNo);
  doc.setSubject(meta.description);
  doc.setProducer('Al-Ittihad Print');
  doc.setCreator('Al-Ittihad Print');
  doc.setCreationDate(new Date());

  const bytes = await doc.save();
  return {
    bytes,
    report: { pageWidthPt: pageW, pageHeightPt: pageH, drawCount, placementsPt, clipped, bytes: bytes.byteLength },
  };
}
