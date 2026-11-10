import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { buildSheetPdf } from '@/lib/pdf/build-sheet';
import { A4_PT, umToPt } from '@/lib/units';
import type { LayoutResult, NormalisedArtwork, SheetPdfOutput, StickerSpec } from '@/lib/types';
import cases from '@/lib/__fixtures__/layout-cases.json';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const outDir = join(__dirname, '..', '..', 'output');

type Case = { name: string; spec: StickerSpec; expected: { ok: boolean; layout?: LayoutResult } };
const layoutOf = (prefix: string): LayoutResult => {
  const c = (cases as Case[]).find((x) => x.name.startsWith(prefix));
  if (!c?.expected.layout) throw new Error('missing fixture ' + prefix);
  return c.expected.layout;
};

function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}

function xobjects(page: PDFPage): PDFRef[] {
  const res = page.node.Resources() as PDFDict;
  const xo = res.lookup(PDFName.of('XObject'), PDFDict);
  return xo.entries().map(([, v]) => v as PDFRef);
}

async function raster(w: number, h: number, alpha = false): Promise<NormalisedArtwork> {
  const img = sharp({
    create: { width: w, height: h, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } },
  });
  const bytes = alpha ? await img.png().toBuffer() : await img.flatten().jpeg({ quality: 90 }).toBuffer();
  return {
    kind: 'raster',
    bytes: new Uint8Array(bytes),
    mime: alpha ? 'image/png' : 'image/jpeg',
    pxWidth: w,
    pxHeight: h,
    hasAlpha: alpha,
    effectiveDpi: 300,
  };
}

async function pdfArtwork(): Promise<NormalisedArtwork> {
  const spec: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 40_000 };
  const r = await normaliseArtwork(fx('cropbox-rot90.pdf'), { spec, targetDpi: 300, blockDpi: 72 });
  if (!r.ok) throw new Error('fixture failed');
  return r.artwork;
}

/** All `a b c d e f cm` matrices in stream order, paired with whether a `Do` follows before the next `Q`. */
function drawMatrices(stream: string): number[][] {
  const out: number[][] = [];
  const re = /([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm\s+\/\S+ Do/g;
  for (const m of stream.matchAll(re)) out.push(m.slice(1, 7).map(Number));
  return out;
}

const MARGIN_PT = umToPt(10_000);
const EPS = 0.01;

async function check(layout: LayoutResult, artwork: NormalisedArtwork, name: string, clipped: boolean) {
  const res: SheetPdfOutput = await buildSheetPdf({
    layout,
    artwork,
    meta: { displayNo: 'EP-251107-TEST', description: name },
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.pdf`), res.bytes);

  const doc = await PDFDocument.load(res.bytes, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(1);
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  expect(Math.abs(width - A4_PT.widthPt)).toBeLessThan(EPS);
  expect(Math.abs(height - A4_PT.heightPt)).toBeLessThan(EPS);
  expect(xobjects(page)).toHaveLength(1);

  const stream = contentOf(page);
  const doCount = (stream.match(/\sDo(\s|$)/g) ?? []).length;
  expect(doCount).toBe(layout.countPerSheet);
  expect(res.report.drawCount).toBe(layout.countPerSheet);
  expect(res.report.placementsPt).toHaveLength(layout.countPerSheet);
  expect(res.report.bytes).toBe(res.bytes.byteLength);
  expect(Math.abs(res.report.pageWidthPt - A4_PT.widthPt)).toBeLessThan(EPS);
  expect(res.report.clipped).toBe(clipped);
  if (clipped) expect(stream).toMatch(/W\s+n/);
  else expect(stream).not.toMatch(/W\s+n/);
  expect(stream).not.toMatch(/\b(BT|ET|Tj|TJ)\b/); // no text

  for (const p of res.report.placementsPt) {
    expect(p.x).toBeGreaterThanOrEqual(MARGIN_PT - EPS);
    expect(p.y).toBeGreaterThanOrEqual(MARGIN_PT - EPS);
    expect(p.x + p.w).toBeLessThanOrEqual(width - MARGIN_PT + EPS);
    expect(p.y + p.h).toBeLessThanOrEqual(height - MARGIN_PT + EPS);
  }
  // y flip: first placement (top row) is at the top of the page.
  const first = res.report.placementsPt[0];
  const firstH = layout.placements[0].turned ? layout.cell.widthUm : layout.cell.heightUm;
  expect(first.y).toBeCloseTo(A4_PT.heightPt - umToPt(layout.placements[0].yUm + firstH), 6);

  expect(doc.getTitle()).toBe('EP-251107-TEST');
  expect(doc.getSubject()).toBe(name);
  expect(doc.getProducer()).toBe('Softy Printing');
  return { res, stream, page };
}

describe('buildSheetPdf', () => {
  let jpg: NormalisedArtwork;
  beforeAll(async () => {
    jpg = await raster(300, 300);
  });

  it('circle-30mm: 54 draws, circle clip, Bezier path', async () => {
    const { stream } = await check(layoutOf('circle-30mm-gapX2-gapY0'), jpg, 'circle-30mm-x54', true);
    expect(stream).toMatch(/ c\n/); // curveto
    expect((stream.match(/W\s+n/g) ?? []).length).toBe(54);
  });

  it('rect-sharp-50x50: 15 draws, no clip', async () => {
    await check(layoutOf('rect-sharp-50x50'), await raster(500, 500), 'rect-sharp-50x50-x15', false);
  });

  it('rect-rounded-50x50: 15 draws, NOT clipped when the aspect matches (corners are preview-only)', async () => {
    const { stream } = await check(layoutOf('rect-rounded-50x50'), await raster(500, 500, true), 'rect-rounded-50x50-x15', false);
    expect(stream).not.toMatch(/W\s+n/);
  });

  it('rect-rounded-50x50 with a non-square artwork: plain rectangle cover-clip only (no curves)', async () => {
    const { stream } = await check(layoutOf('rect-rounded-50x50'), await raster(500, 400, true), 'rect-rounded-50x50-wide-x15', true);
    expect(stream).toMatch(/W\s+n/);
    expect(stream).not.toMatch(/ c\s/); // no bezier segments: the clip is a plain rectangle
  });

  it('rect-sharp-200x50 rotated: 3 draws, artwork turned 90 degrees about each cell centre', async () => {
    const layout = layoutOf('rect-sharp-200x50-fits-when-rotated');
    expect(layout.rotated).toBe(true);
    expect(layout.turnedCount).toBe(0);
    const art = await raster(2000, 500); // sticker orientation: 200 x 50
    const { res, stream } = await check(layout, art, 'rect-sharp-200x50-rotated-x3', false);
    const ms = drawMatrices(stream);
    expect(ms).toHaveLength(3);
    ms.forEach((m, i) => {
      const cell = res.report.placementsPt[i];
      // 90 degree rotation: no axis-aligned scale terms.
      expect(Math.abs(m[0])).toBeLessThan(1e-9);
      expect(Math.abs(m[3])).toBeLessThan(1e-9);
      // Image (unit square) footprint == the swapped cell, centred on it.
      const xs = [m[4], m[4] + m[0] + m[2]];
      const ys = [m[5], m[5] + m[1] + m[3]];
      expect(Math.min(...xs)).toBeCloseTo(cell.x, 4);
      expect(Math.max(...xs)).toBeCloseTo(cell.x + cell.w, 4);
      expect(Math.min(...ys)).toBeCloseTo(cell.y, 4);
      expect(Math.max(...ys)).toBeCloseTo(cell.y + cell.h, 4);
    });
    // Clockwise: image +x axis (first column) points DOWN in PDF space.
    expect(ms[0][1]).toBeLessThan(0);
  });

  it('upright image footprint equals the cell exactly', async () => {
    const { res, stream } = await check(layoutOf('rect-sharp-50x50'), await raster(500, 500), 'rect-sharp-x15-b', false);
    drawMatrices(stream).forEach((m, i) => {
      const c = res.report.placementsPt[i];
      expect([m[0], m[1], m[2], m[3]].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([c.w, 0, 0, c.h].map((v) => Math.round(v * 1e6) / 1e6));
      expect(m[4]).toBeCloseTo(c.x, 6);
      expect(m[5]).toBeCloseTo(c.y, 6);
    });
  });

  it('circle with a non-square image covers the square cell (centre crop)', async () => {
    const { res, stream } = await check(layoutOf('circle-30mm-gapX2-gapY0'), await raster(600, 300, true), 'circle-30mm-wide-art-x54', true);
    const m = drawMatrices(stream)[0];
    const c = res.report.placementsPt[0];
    // height fills the cell, width overflows to 2x and is centred.
    expect(m[3]).toBeCloseTo(c.h, 6);
    expect(m[0]).toBeCloseTo(c.w * 2, 6);
    expect(m[4] + m[0] / 2).toBeCloseTo(c.x + c.w / 2, 6);
  });

  it('PDF artwork (CropBox + /Rotate 90): one form XObject, 54 draws, rotation applied', async () => {
    const art = await pdfArtwork();
    const { page, stream, res } = await check(layoutOf('circle-30mm-gapX2-gapY0'), art, 'circle-30mm-pdf-art-x54', true);
    expect(xobjects(page)).toHaveLength(1);
    const xo = page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const form = xo.lookup(xo.keys()[0]) as PDFRawStream;
    expect(form.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Form');
    expect(form.dict.get(PDFName.of('BBox'))?.toString()).toBe('[ 100 100 500 400 ]');
    // /Rotate 90 -> displayed 300 x 400 (portrait) covers the square cell: width fills, height overflows.
    const m = drawMatrices(stream)[0];
    const c = res.report.placementsPt[0];
    expect(Math.abs(m[0])).toBeLessThan(1e-9);
    const footprintX = Math.abs(m[2]) * 300; // form native box is 400 x 300 pt
    const footprintY = Math.abs(m[1]) * 400;
    expect(footprintX).toBeGreaterThanOrEqual(c.w - 1e-6);
    expect(footprintY).toBeGreaterThanOrEqual(c.h - 1e-6);
  });

  it('mixed pinwheel layout (100x40 allowRotate, 11 vs 8 plain): every cell covered exactly, art follows each cell orientation', async () => {
    const layout = layoutOf('rect-rounded-100x40-allowRotate');
    expect(layout.countPerSheet).toBe(11);
    expect(layout.turnedCount).toBeGreaterThan(0);
    expect(layout.turnedCount).toBeLessThan(layout.countPerSheet);
    const art = await raster(1000, 400); // sticker orientation: 100 x 40
    const { res, stream } = await check(layout, art, 'rect-rounded-100x40-mixed-x11', false);
    const ms = drawMatrices(stream);
    expect(ms).toHaveLength(11);
    ms.forEach((m, i) => {
      const p = layout.placements[i];
      const cell = res.report.placementsPt[i];
      const w = umToPt(p.turned ? layout.cell.heightUm : layout.cell.widthUm);
      const h = umToPt(p.turned ? layout.cell.widthUm : layout.cell.heightUm);
      expect(cell.w).toBeCloseTo(w, 6);
      expect(cell.h).toBeCloseTo(h, 6);
      // Sticker is 100 wide x 40 tall: a wide cell holds upright art, a tall cell turned art.
      const artTurned = layout.rotated !== Boolean(p.turned);
      expect(artTurned).toBe(cell.h > cell.w);
      if (artTurned) {
        expect(Math.abs(m[0])).toBeLessThan(1e-9);
        expect(m[1]).toBeLessThan(0); // clockwise
      } else {
        expect(Math.abs(m[1])).toBeLessThan(1e-9);
        expect(m[0]).toBeGreaterThan(0);
      }
      const xs = [m[4], m[4] + m[0] + m[2]];
      const ys = [m[5], m[5] + m[1] + m[3]];
      expect(Math.min(...xs)).toBeCloseTo(cell.x, 4);
      expect(Math.max(...xs)).toBeCloseTo(cell.x + cell.w, 4);
      expect(Math.min(...ys)).toBeCloseTo(cell.y, 4);
      expect(Math.max(...ys)).toBeCloseTo(cell.y + cell.h, 4);
    });
  });

  it('PDF artwork in a rotated layout rotates a further 90 degrees (180 total)', async () => {
    const art = await pdfArtwork();
    const { stream } = await check(layoutOf('rect-sharp-200x50-fits-when-rotated'), art, 'rect-sharp-pdf-rotated-x3', true);
    const m = drawMatrices(stream)[0];
    expect(Math.abs(m[1])).toBeLessThan(1e-9);
    expect(m[0]).toBeLessThan(0);
    expect(m[3]).toBeLessThan(0);
  });

  it('one embedded object regardless of count (file stays small)', async () => {
    const res = await buildSheetPdf({
      layout: layoutOf('circle-30mm-gapX2-gapY0'),
      artwork: await raster(800, 800),
      meta: { displayNo: 'EP-X', description: 'size check' },
    });
    const single = await raster(800, 800);
    expect(res.bytes.byteLength).toBeLessThan(single.bytes.byteLength + 20_000);
  });
});
