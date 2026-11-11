/**
 * The artwork box of a PDF design: one rule shared by the server (`normalise.server.ts`) and
 * the browser (`prepare.client.ts`, staff page), so both embed the same region with the same
 * turn. Isomorphic: no Node or browser APIs, and pdf-lib is only a type here.
 *
 * Rule (docs/PLAN.md §3): page 1; box = TrimBox ?? CropBox ?? MediaBox (pdf-lib's CropBox
 * getter already falls back to the MediaBox); rotate = page /Rotate rounded to a multiple of
 * 90° and brought into 0..270. The box is the RAW, unrotated one (what `embedPage` needs).
 */
import type { PDFDocument } from 'pdf-lib';

export interface PdfArtworkBox {
  box: { x: number; y: number; width: number; height: number };
  rotate: 0 | 90 | 180 | 270;
  pageCount: number;
}

/**
 * Box, turn and page count of page 1; null when the document has no page or the box is
 * empty. May throw on a malformed page tree; callers treat that like null.
 */
export function pdfArtworkBox(doc: PDFDocument): PdfArtworkBox | null {
  const pageCount = doc.getPageCount();
  if (pageCount < 1) return null;
  const page = doc.getPage(0);
  const b = page.node.TrimBox() ? page.getTrimBox() : page.getCropBox(); // CropBox falls back to MediaBox
  const box = { x: b.x, y: b.y, width: b.width, height: b.height };
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const raw = Math.round(page.getRotation().angle / 90) * 90;
  const rotate = (((raw % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  return { box, rotate, pageCount };
}

/** True for pdf-lib's "is encrypted" load error. instanceof is unreliable when pdf-lib is loaded through both its CJS and ESM builds. */
export function isEncryptedPdfError(e: unknown): boolean {
  return e instanceof Error && (e.constructor.name === 'EncryptedPDFError' || /is encrypted/i.test(e.message));
}
