/**
 * The staff page's receipt sheet: ONE A4 page with the receipt design drawn once per slot
 * (spec 2026-11-26, B2/B3). ISOMORPHIC like build-staff-pdf.ts: the browser builds it, nothing is
 * uploaded. The artwork is embedded once (shared `embedArtwork`) and every slot is
 * `q <slot rect> W n <cm> /X Do Q`: the (turned) design is STRETCHED to fill its slot exactly,
 * no proportion keeping, no cutter dots, no margin (receipts are cut by guillotine).
 */
import { PDFDocument, clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, type PDFOperator, type PDFPage } from 'pdf-lib';
import { receiptSlots, spacingFits, type ReceiptFormat, type ReceiptSpacing } from '@/lib/receipts/formats';
import { A4_PT, umToPt } from '@/lib/units';
import type { NormalisedArtwork } from '@/lib/types';
import { PDF_PRODUCER, embedArtwork, rectPath, setPrintAtActualSize } from './sheet-page';

export const RECEIPT_PDF_TITLE = 'Softy receipts';

export interface ReceiptPdfInput {
  format: ReceiptFormat;
  /** The white around and between the receipts (it already encodes an A6 card's white side). Must fit: see `spacingFits`. */
  spacing: ReceiptSpacing;
  /** The employee's turn, clockwise degrees (a multiple of 90). Added to the artwork's own turn (PDF /Rotate, EXIF). */
  turnCw: number;
  artwork: NormalisedArtwork;
}

export async function buildReceiptPdf(input: ReceiptPdfInput, now: Date): Promise<Uint8Array> {
  if (!spacingFits(input.format, input.spacing)) throw new Error('receipt spacing does not fit the page');
  const doc = await PDFDocument.create();
  const pageH = A4_PT.heightPt;
  const page: PDFPage = doc.addPage([A4_PT.widthPt, pageH]);
  const { xobjectName, bw, bh, isImage, pageRotateCw } = await embedArtwork(doc, page, input.artwork);

  // phi is a multiple of 90, so the rounded cos/sin are exact.
  const phi = (((pageRotateCw + input.turnCw) % 360) + 360) % 360;
  const rad = (phi * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const swap = phi === 90 || phi === 270;
  const dispW = swap ? bh : bw;
  const dispH = swap ? bw : bh;

  for (const slot of receiptSlots(input.format, input.spacing)) {
    const w = umToPt(slot.widthUm);
    const h = umToPt(slot.heightUm);
    const x = umToPt(slot.xUm);
    const y = pageH - umToPt(slot.yUm + slot.heightUm);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const sx = w / dispW;
    const sy = h / dispH;
    // Clockwise turn by phi in y-up space, scaled by sx across the displayed width and sy down it.
    const a = sx * cos;
    const b = -sy * sin;
    const c = sx * sin;
    const d = sy * cos;
    const e = cx - (a * (bw / 2) + c * (bh / 2));
    const f = cy - (b * (bw / 2) + d * (bh / 2));
    // Images map the unit square to pixels, so fold the native size into the matrix.
    const m = isImage ? [a * bw, b * bw, c * bh, d * bh, e, f] : [a, b, c, d, e, f];
    const ops: PDFOperator[] = [
      pushGraphicsState(),
      ...rectPath(x, y, w, h),
      clip(),
      endPath(),
      concatTransformationMatrix(m[0], m[1], m[2], m[3], m[4], m[5]),
      drawObject(xobjectName),
      popGraphicsState(),
    ];
    page.pushOperators(...ops);
  }

  setPrintAtActualSize(doc);
  doc.setTitle(RECEIPT_PDF_TITLE);
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc.save();
}
