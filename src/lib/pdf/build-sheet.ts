import 'server-only';
/**
 * A4 sheet PDF builder — OWNED BY AGENT B. Node only (pdf-lib).
 *
 * Contract (docs/PLAN.md §4):
 *  - One page, exactly A4_PT (595.2756 × 841.8898 pt).
 *  - Embed the artwork ONCE (embedPng/embedJpg, or embedPage with boundingBox =
 *    artwork.box for PDFs) and draw it countPerSheet times.
 *  - Convert µm → pt with umToPt(); flip y: yPt = pageHeightPt − umToPt(yUm + cellHeightUm).
 *  - Clip per layout.clip using raw operators (pushOperators: q, path, W n, draw, Q).
 *    Circle = 4 Béziers (k = 0.5523); roundedRect radius = clip.radiusUm.
 *    Rotated layouts: the cell is already swapped by the engine; rotate the
 *    artwork 90° about the cell centre so it fills the swapped cell.
 *  - NO text, NO marks, NO cut lines (owner cuts manually). Metadata only:
 *    setTitle(meta.displayNo), setSubject(meta.description), setProducer('Al-Ittihad Print'),
 *    setCreationDate(new Date()).
 *  - Report drawCount by counting draw ops you emitted (must equal countPerSheet),
 *    placementsPt in the same order as layout.placements.
 */
import type { SheetPdfInput, SheetPdfOutput } from '@/lib/types';

export async function buildSheetPdf(input: SheetPdfInput): Promise<SheetPdfOutput> {
  void input;
  throw new Error('NOT_IMPLEMENTED: buildSheetPdf (Agent B)');
}
