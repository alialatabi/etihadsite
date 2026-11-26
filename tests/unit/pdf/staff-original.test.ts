/**
 * End to end for the staff page's original-quality export: prepareOriginalArtwork -> buildStaffPdf.
 * The Image XObject of the output must be the uploaded JPEG itself (DCTDecode, its colour space,
 * its size, its bytes), and an EXIF-turned JPEG must be drawn turned 90 degrees clockwise.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { prepareOriginalArtwork } from '@/lib/design/original.client';
import { buildStaffPdf } from '@/lib/pdf/build-staff-pdf';
import type { DesignSource, StickerSpec } from '@/lib/types';
import { contentOf, layoutFor } from './pdf-helpers';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const rect = (wMm: number, hMm: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: wMm * 1000, heightUm: hMm * 1000 });

function jpegSource(bytes: Uint8Array, px: [number, number]): DesignSource {
  return { kind: 'jpeg', file: new File([new Uint8Array(bytes)], 'design.jpg', { type: 'image/jpeg' }), pxWidth: px[0], pxHeight: px[1], hasAlpha: false, previewUrl: 'blob:preview' };
}

/** The staff PDF of one design, and what its first page draws. */
async function staffPdf(src: DesignSource, spec: StickerSpec) {
  const prepared = await prepareOriginalArtwork(src, spec);
  if (!prepared.ok) throw new Error(prepared.error);
  const layout = layoutFor(spec);
  const out = await buildStaffPdf([{ layout, artwork: prepared.artwork }], NOW);
  const doc = await PDFDocument.load(out, { updateMetadata: false });
  const page = doc.getPage(0);
  const xo = (page.node.Resources() as PDFDict).lookup(PDFName.of('XObject'), PDFDict);
  const names = xo.keys();
  expect(names).toHaveLength(1); // embedded once
  const image = xo.lookup(names[0]) as PDFRawStream;
  const stream = contentOf(page);
  const num = '(-?[\\d.]+(?:e-?\\d+)?)';
  const draws = [...stream.matchAll(new RegExp(`${num} ${num} ${num} ${num} ${num} ${num} cm\\s+/${names[0].decodeText()} Do`, 'g'))].map((m) => m.slice(1, 7).map(Number));
  return { layout, image, draws };
}

const nameOf = (d: PDFDict, key: string) => d.get(PDFName.of(key))?.toString();
const numOf = (d: PDFDict, key: string) => (d.get(PDFName.of(key)) as PDFNumber).asNumber();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe('staff PDF carries the uploaded JPEG as it is', () => {
  it('a CMYK JPEG: DCTDecode, DeviceCMYK, same size, same bytes', async () => {
    const bytes = new Uint8Array(
      await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .toColourspace('cmyk')
        .jpeg()
        .toBuffer(),
    );
    const { image, draws, layout } = await staffPdf(jpegSource(bytes, [240, 160]), rect(60, 40));
    expect(nameOf(image.dict, 'Subtype')).toBe('/Image');
    expect(nameOf(image.dict, 'Filter')).toBe('/DCTDecode');
    expect(nameOf(image.dict, 'ColorSpace')).toBe('/DeviceCMYK');
    expect([numOf(image.dict, 'Width'), numOf(image.dict, 'Height')]).toEqual([240, 160]);
    expect(image.dict.lookup(PDFName.of('Decode'), PDFArray).size()).toBe(8); // Adobe CMYK is stored inverted
    expect(same(image.contents, bytes)).toBe(true);
    expect(draws).toHaveLength(layout.countPerSheet);
  });

  it('an RGB JPEG: DeviceRGB, same bytes', async () => {
    const bytes = fx('opaque-300x300.jpg');
    const { image } = await staffPdf(jpegSource(bytes, [300, 300]), rect(30, 30));
    expect(nameOf(image.dict, 'Filter')).toBe('/DCTDecode');
    expect(nameOf(image.dict, 'ColorSpace')).toBe('/DeviceRGB');
    expect([numOf(image.dict, 'Width'), numOf(image.dict, 'Height')]).toEqual([300, 300]);
    expect(same(image.contents, bytes)).toBe(true);
  });

  it('an EXIF-6 JPEG (stored 600x400): stored bytes untouched, drawn turned 90 degrees clockwise upright', async () => {
    const bytes = fx('exif6-600x400.jpg');
    const spec = rect(40, 60);
    const { image, draws, layout } = await staffPdf(jpegSource(bytes, [400, 600]), spec);
    expect([numOf(image.dict, 'Width'), numOf(image.dict, 'Height')]).toEqual([600, 400]);
    expect(same(image.contents, bytes)).toBe(true);

    // The 40 x 60 mm sticker is portrait like the oriented image: no extra turn from the layout.
    expect(layout.rotated).toBe(false);
    expect(layout.placements.every((p) => !p.turned)).toBe(true);
    expect(draws).toHaveLength(layout.countPerSheet);
    for (const [a, b, c, d] of draws) {
      // Clockwise 90 degrees in y-up space: [cos, -sin, sin, cos] with cos 0 and sin 1 (image unit square scaled by bw, bh).
      expect(a).toBeCloseTo(0, 6);
      expect(d).toBeCloseTo(0, 6);
      expect(b).toBeLessThan(0);
      expect(c).toBeGreaterThan(0);
      // The drawn box is the oriented 400:600 portrait: width = |c| (from the 400 px side), height = |b| (from the 600 px side).
      expect(Math.abs(c) / Math.abs(b)).toBeCloseTo(400 / 600, 6);
    }
  });
});
