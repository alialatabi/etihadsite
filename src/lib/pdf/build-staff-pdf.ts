/**
 * The staff page's print-and-cut PDF: one A4 page per design, in the order given, each drawn by
 * the shared sheet-page drawer (stickers + the 4 cutter dots). ISOMORPHIC: the staff page builds
 * it in the browser (dynamic import), nothing is uploaded. No customer data in the metadata.
 */
import { PDFDocument } from 'pdf-lib';
import { PDF_PRODUCER, drawSheetPage, setPrintAtActualSize } from './sheet-page';
import type { LayoutResult, NormalisedArtwork } from '@/lib/types';

export const STAFF_PDF_TITLE = 'Softy sheets';

export async function buildStaffPdf(items: { layout: LayoutResult; artwork: NormalisedArtwork }[], now: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const item of items) await drawSheetPage(doc, item.layout, item.artwork);
  setPrintAtActualSize(doc);
  doc.setTitle(STAFF_PDF_TITLE);
  doc.setProducer(PDF_PRODUCER);
  doc.setCreator(PDF_PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc.save();
}
