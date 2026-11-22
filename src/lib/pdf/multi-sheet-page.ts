/**
 * One A4 page of a MULTI-design sticker sheet, drawn into a pdf-lib document. ISOMORPHIC: no
 * `server-only`, no `node:` APIs. Mirrors drawSheetPage (./sheet-page.ts) and reuses its
 * helpers, so every sticker is drawn exactly the same way; the difference is that each design
 * has its own artwork, cell size and clip.
 *
 * Per design: the artwork is embedded ONCE; an upright and a turned variant are computed from
 * layout.designs[i] (cell swapped and art turned 90 degrees clockwise when turned, artwork scaled
 * to COVER the cell, clip from the design's clip incl. rounded corners / circle, an extra
 * rectangle clip when there is no clip but the cover overflow exceeds the tolerance). Every
 * placement is drawn with its design's variant: `q [<clip> W n] a b c d e f cm /Name Do Q`.
 * Then, when `layout.marks` is present, the 4 cutter dots in the same `sk_marks` layer.
 */
import {
  PDFDocument,
  PDFOperator,
  clip,
  concatTransformationMatrix,
  drawObject,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  type PDFPage,
} from 'pdf-lib';
import { A4_PT, umToPt } from '@/lib/units';
import type { MultiLayoutResult, NormalisedArtwork } from '@/lib/types';
import {
  COVER_OVERFLOW_TOLERANCE,
  circlePath,
  embedArtwork,
  marksOperators,
  rectPath,
  roundedRectPath,
  type EmbeddedArtwork,
} from './sheet-page';

interface Variant {
  cos: number;
  sin: number;
  cellHeightUm: number;
  cellW: number;
  cellH: number;
  cover: number;
  extraRectClip: boolean;
  cornerPt: number;
}

interface DesignDraw {
  embedded: EmbeddedArtwork;
  clipKind: 'none' | 'circle' | 'roundedRect';
  upright: Variant;
  turned: Variant;
}

export async function drawMultiSheetPage(
  doc: PDFDocument,
  layout: MultiLayoutResult,
  artworks: NormalisedArtwork[],
): Promise<{ drawCount: number; placementsPt: { x: number; y: number; w: number; h: number }[]; clipped: boolean }> {
  if (artworks.length !== layout.designs.length) {
    throw new Error(`drawMultiSheetPage: ${artworks.length} artworks for ${layout.designs.length} designs`);
  }
  const pageW = A4_PT.widthPt;
  const pageH = A4_PT.heightPt;
  const page: PDFPage = doc.addPage([pageW, pageH]);

  const draws: DesignDraw[] = [];
  for (let i = 0; i < layout.designs.length; i++) {
    const design = layout.designs[i];
    const embedded = await embedArtwork(doc, page, artworks[i]);
    const { bw, bh, pageRotateCw } = embedded;
    const clipKind = design.clip.kind === 'roundedRect' && design.clip.radiusUm <= 0 ? 'none' : design.clip.kind;
    const radiusPt = design.clip.kind === 'roundedRect' ? umToPt(design.clip.radiusUm) : 0;

    // `turned` cells use the design's cell swapped and the art turned a further 90 degrees clockwise.
    const variant = (turned: boolean): Variant => {
      const phi = (((pageRotateCw + (turned ? 90 : 0)) % 360) + 360) % 360;
      const rad = (phi * Math.PI) / 180;
      const cos = Math.round(Math.cos(rad));
      const sin = Math.round(Math.sin(rad)); // phi is a multiple of 90
      const swap = phi === 90 || phi === 270;
      const dispW = swap ? bh : bw;
      const dispH = swap ? bw : bh;
      const cellUm = turned
        ? { widthUm: design.cell.heightUm, heightUm: design.cell.widthUm }
        : { widthUm: design.cell.widthUm, heightUm: design.cell.heightUm };
      const cellW = umToPt(cellUm.widthUm);
      const cellH = umToPt(cellUm.heightUm);
      const cover = Math.max(cellW / dispW, cellH / dispH);
      const overflow = Math.max((dispW * cover) / cellW, (dispH * cover) / cellH) - 1;
      const extraRectClip = clipKind === 'none' && overflow > COVER_OVERFLOW_TOLERANCE;
      const cornerPt = Math.min(radiusPt, Math.min(cellW, cellH) / 2);
      return { cos, sin, cellHeightUm: cellUm.heightUm, cellW, cellH, cover, extraRectClip, cornerPt };
    };
    draws.push({ embedded, clipKind, upright: variant(false), turned: variant(true) });
  }

  const placementsPt: { x: number; y: number; w: number; h: number }[] = [];
  let drawCount = 0;
  let clipped = false;

  for (const p of layout.placements) {
    const dd = draws[p.designIndex];
    if (!dd) throw new Error(`drawMultiSheetPage: placement for unknown design ${p.designIndex}`);
    const { xobjectName, bw, bh, isImage } = dd.embedded;
    const { cos, sin, cellHeightUm, cellW, cellH, cover, extraRectClip, cornerPt } = p.turned ? dd.turned : dd.upright;
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
    if (dd.clipKind === 'circle') {
      ops.push(...circlePath(cx, cy, Math.min(cellW, cellH) / 2), clip(), endPath());
      clipped = true;
    } else if (dd.clipKind === 'roundedRect') {
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
