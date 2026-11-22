/**
 * A4 sheet PDF builder for multi-design customer orders. Isomorphic (no `server-only`): like
 * build-sheet.ts it draws ONE A4 page through a shared drawer (./multi-sheet-page.ts: each
 * design's artwork embedded ONCE and drawn at every one of its cells, the 4 cutter dots when the
 * layout has `marks`), then sets the order metadata and the "print at actual size" preference.
 * NO text and no cut lines. Same metadata, producer and report fields as build-sheet.ts.
 */
import { PDFDocument } from 'pdf-lib';
import { A4_PT } from '@/lib/units';
import type { MultiSheetPdfInput, SheetPdfOutput } from '@/lib/types';
import { drawMultiSheetPage } from './multi-sheet-page';
import { PDF_PRODUCER, setPrintAtActualSize } from './sheet-page';

export async function buildMultiSheetPdf(input: MultiSheetPdfInput): Promise<SheetPdfOutput> {
  const { layout, artworks, meta } = input;

  const doc = await PDFDocument.create();
  const { drawCount, placementsPt, clipped } = await drawMultiSheetPage(doc, layout, artworks);
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
