/**
 * The staff page's multi-page PDF (src/lib/pdf/build-staff-pdf.ts): one A4 page per design,
 * each with its own dots block in the shared `sk_marks` layer, neutral metadata, actual-size printing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import { buildStaffPdf } from '@/lib/pdf/build-staff-pdf';
import { A4_PT } from '@/lib/units';
import type { LayoutResult, LayoutSettings, NormalisedArtwork, StickerSpec } from '@/lib/types';

const SETTINGS: LayoutSettings = { ...DEFAULT_SETTINGS.layout, marginUm: 3_000 };
const NOW = new Date('2026-11-12T10:30:00.000Z');

function layoutFor(spec: StickerSpec): LayoutResult {
  const out = computeLayout(spec, layoutParamsFor(spec, SETTINGS));
  if (!out.ok) throw new Error(`layout failed: ${out.reason}`);
  return out.layout;
}

function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}

async function items() {
  const circle: StickerSpec = { shape: 'circle', widthUm: 58_000, heightUm: 58_000 };
  const jpg = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
  const rasterArt: NormalisedArtwork = { kind: 'raster', bytes: new Uint8Array(jpg), mime: 'image/jpeg', pxWidth: 300, pxHeight: 300, hasAlpha: false, effectiveDpi: 300 };

  const rect: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 40_000 };
  const pdf = new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', 'cropbox-rot90.pdf')));
  const r = await normaliseArtwork(pdf, { spec: rect, targetDpi: 300, blockDpi: 72 });
  if (!r.ok) throw new Error('fixture failed');

  return [
    { layout: layoutFor(circle), artwork: rasterArt },
    { layout: layoutFor(rect), artwork: r.artwork },
  ];
}

describe('buildStaffPdf', () => {
  it('one A4 page per item, in order, each with its stickers and its own dots block', async () => {
    const input = await items();
    const bytes = await buildStaffPdf(input, NOW);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);

    const ocgs = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(1);
    const ocgRef = ocgs.get(0).toString();

    doc.getPages().forEach((page, i) => {
      const { width, height } = page.getSize();
      expect(width).toBeCloseTo(A4_PT.widthPt, 6);
      expect(height).toBeCloseTo(A4_PT.heightPt, 6);
      const stream = contentOf(page);
      expect((stream.match(/\sDo(\s|$)/g) ?? []).length).toBe(input[i].layout.countPerSheet);
      const bdc = [...stream.matchAll(/\/OC \/(\S+) BDC[\s\S]*?0 0 0 1 k[\s\S]*?f\*\s+EMC/g)];
      expect(bdc).toHaveLength(1);
      const props = (page.node.Resources() as PDFDict).lookup(PDFName.of('Properties'), PDFDict);
      expect(props.get(PDFName.of(bdc[0][1]))?.toString()).toBe(ocgRef);
    });
    // Page 2 embeds the vector PDF design as a form XObject with its CropBox.
    const xo = (doc.getPage(1).node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
    const form = xo.lookup(xo.keys()[0]) as PDFRawStream;
    expect(form.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Form');
    expect(form.dict.get(PDFName.of('BBox'))?.toString()).toBe('[ 100 100 500 400 ]');
  });

  it('metadata: title Softy sheets, producer and creator Softy Printing, dated now; print at actual size', async () => {
    const doc = await PDFDocument.load(await buildStaffPdf(await items(), NOW), { updateMetadata: false });
    expect(doc.getTitle()).toBe('Softy sheets');
    expect(doc.getProducer()).toBe('Softy Printing');
    expect(doc.getCreator()).toBe('Softy Printing');
    expect(doc.getCreationDate()?.toISOString()).toBe(NOW.toISOString());
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict).get(PDFName.of('PrintScaling'))?.toString()).toBe('/None');
  });

  it('is deterministic for the same input and date', async () => {
    const input = await items();
    const a = await buildStaffPdf(input, NOW);
    const b = await buildStaffPdf(input, NOW);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
