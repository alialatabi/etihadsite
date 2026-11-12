import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { isEncryptedPdfError, pdfArtworkBox } from '@/lib/design/pdf-box';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import type { StickerSpec } from '@/lib/types';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const spec: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 30_000, heightUm: 40_000 };

/** What the server (normaliseArtwork) says about these PDF bytes, in pdfArtworkBox's shape. */
async function serverView(bytes: Uint8Array) {
  const r = await normaliseArtwork(bytes, { spec, targetDpi: 300, blockDpi: 72 });
  if (!r.ok) return { error: r.error };
  if (r.artwork.kind !== 'pdf') throw new Error('expected a pdf artwork');
  return { box: r.artwork.box, rotate: r.artwork.rotate, pageCount: r.artwork.pageCount };
}

/** pdfArtworkBox's answer, with load failures mapped the way the server maps them. */
async function sharedView(bytes: Uint8Array) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch (e) {
    return { error: isEncryptedPdfError(e) ? 'encrypted' : 'needs_raster' };
  }
  return pdfArtworkBox(doc) ?? { error: 'needs_raster' };
}

async function generated(opts: { size: [number, number]; crop?: [number, number, number, number]; trim?: [number, number, number, number]; rotate?: number; pages?: number }) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < (opts.pages ?? 1); i++) {
    const page = doc.addPage(opts.size);
    if (opts.crop) page.setCropBox(...opts.crop);
    if (opts.trim) page.setTrimBox(...opts.trim);
    if (opts.rotate !== undefined) page.setRotation(degrees(opts.rotate));
  }
  return new Uint8Array(await doc.save());
}

describe('pdfArtworkBox', () => {
  const pdfFixtures = readdirSync(FIXTURES).filter((n) => n.endsWith('.pdf'));

  it('covers every PDF in tests/fixtures', () => {
    expect(pdfFixtures).toEqual(expect.arrayContaining(['cropbox-rot90.pdf', 'encrypted-marker.pdf', 'two-page.pdf']));
  });

  for (const name of pdfFixtures) {
    it(`equals the server result for ${name}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
      expect(await sharedView(bytes)).toEqual(await serverView(bytes));
    });
  }

  it('cropbox-rot90.pdf: raw CropBox and /Rotate 90', async () => {
    const doc = await PDFDocument.load(readFileSync(join(FIXTURES, 'cropbox-rot90.pdf')));
    expect(pdfArtworkBox(doc)).toEqual({ box: { x: 100, y: 100, width: 400, height: 300 }, rotate: 90, pageCount: 1 });
  });

  const CASES: [string, Parameters<typeof generated>[0]][] = [
    ['TrimBox wins over CropBox', { size: [600, 800], crop: [10, 10, 500, 700], trim: [50, 60, 200, 100] }],
    ['MediaBox when there is no CropBox or TrimBox', { size: [141.73, 255.12] }],
    ['/Rotate 270', { size: [300, 200], rotate: 270 }],
    ['/Rotate -90 becomes 270', { size: [300, 200], rotate: -90 }],
    ['/Rotate 450 becomes 90', { size: [300, 200], rotate: 450 }],
    ['/Rotate 180 with a CropBox', { size: [300, 200], crop: [5, 5, 100, 50], rotate: 180 }],
    ['three pages', { size: [100, 100], pages: 3 }],
    ['empty TrimBox', { size: [300, 200], trim: [0, 0, 0, 50] }],
  ];
  for (const [name, opts] of CASES) {
    it(`equals the server result: ${name}`, async () => {
      const bytes = await generated(opts);
      expect(await sharedView(bytes)).toEqual(await serverView(bytes));
    });
  }

  it('returns null for an empty box', async () => {
    const doc = await PDFDocument.load(await generated({ size: [300, 200], trim: [0, 0, 0, 50] }));
    expect(pdfArtworkBox(doc)).toBeNull();
  });

  it('returns null for a document without pages', async () => {
    const doc = await PDFDocument.create();
    expect(pdfArtworkBox(doc)).toBeNull();
  });

  it('isEncryptedPdfError recognises only the encrypted error', async () => {
    let err: unknown;
    try {
      await PDFDocument.load(readFileSync(join(FIXTURES, 'encrypted-marker.pdf')));
    } catch (e) {
      err = e;
    }
    expect(isEncryptedPdfError(err)).toBe(true);
    expect(isEncryptedPdfError(new Error('Failed to parse PDF'))).toBe(false);
    expect(isEncryptedPdfError('is encrypted')).toBe(false);
  });
});
