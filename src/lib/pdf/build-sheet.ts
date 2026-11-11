import 'server-only';
/**
 * A4 sheet PDF builder for customer orders. Node only (called by the order route).
 *
 * One A4 page drawn by the shared, isomorphic drawer (./sheet-page.ts: artwork embedded ONCE
 * and drawn countPerSheet times, circle / rounded-rectangle clips, the 4 cutter dots when the
 * layout has `marks`), plus the order metadata and the "print at actual size" preference.
 * NO text and no cut lines.
 */
import { PDFDocument } from 'pdf-lib';
import { A4_PT } from '@/lib/units';
import type { SheetPdfInput, SheetPdfOutput } from '@/lib/types';
import { PDF_PRODUCER, drawSheetPage, setPrintAtActualSize } from './sheet-page';

export async function buildSheetPdf(input: SheetPdfInput): Promise<SheetPdfOutput> {
  const { layout, artwork, meta } = input;

  const doc = await PDFDocument.create();
  const { drawCount, placementsPt, clipped } = await drawSheetPage(doc, layout, artwork);
  setPrintAtActualSize(doc);

  doc.setTitle(meta.displayNo);
  doc.setSubject(meta.description);
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  doc.setCreationDate(new Date());

  const bytes = await doc.save();
  return {
    bytes,
    report: { pageWidthPt: A4_PT.widthPt, pageHeightPt: A4_PT.heightPt, drawCount, placementsPt, clipped, bytes: bytes.byteLength },
  };
}
