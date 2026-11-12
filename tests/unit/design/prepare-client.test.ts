/**
 * prepareArtwork (src/lib/design/prepare.client.ts): the staff page's in-browser version of the
 * server's normaliseArtwork. The browser image APIs are replaced by ./browser-mock.ts (sharp
 * underneath), and every case that the server also handles is compared with normaliseArtwork.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { ALPHA_THRESHOLD, alphaBoundingBox } from '@/lib/design/pixels';
import { MAX_CANVAS_PIXELS, downscaleSteps, prepareArtwork } from '@/lib/design/prepare.client';
import type { DesignSource, NormalisedArtwork, PixelBox, StickerSpec } from '@/lib/types';
const rasterise = vi.hoisted(() => vi.fn());
vi.mock('@/lib/design/decode.client', () => ({ rasterisePdfPage: rasterise }));

import { installBrowserMock, type BrowserMock } from './browser-mock';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const rect = (wMm: number, hMm: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: wMm * 1000, heightUm: hMm * 1000 });
const circle = (dMm: number): StickerSpec => ({ shape: 'circle', widthUm: dMm * 1000, heightUm: dMm * 1000 });
const custom = (wMm: number, hMm: number): StickerSpec => ({ shape: 'custom', widthUm: wMm * 1000, heightUm: hMm * 1000 });

const MIME = { png: 'image/png', jpeg: 'image/jpeg', pdf: 'application/pdf' } as const;

/** A DesignSource as decodeDesign() would hand it over (only the fields prepareArtwork reads matter). */
function source(bytes: Uint8Array, kind: DesignSource['kind'], extra: { px: [number, number]; hasAlpha: boolean; trim?: PixelBox }): DesignSource {
  return {
    kind,
    file: new File([new Uint8Array(bytes)], `design.${kind === 'jpeg' ? 'jpg' : kind}`, { type: MIME[kind] }),
    pxWidth: extra.px[0],
    pxHeight: extra.px[1],
    hasAlpha: extra.hasAlpha,
    previewUrl: 'blob:preview',
    ...(extra.trim ? { trim: extra.trim } : {}),
  };
}

async function decoded(bytes: Uint8Array) {
  const out = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(bytes).metadata();
  return { width: out.info.width, height: out.info.height, pixels: out.data, meta };
}

const raster = (a: NormalisedArtwork) => {
  if (a.kind !== 'raster') throw new Error('expected a raster artwork');
  return a;
};

let mock: BrowserMock;
beforeEach(() => {
  mock = installBrowserMock();
  rasterise.mockReset();
  rasterise.mockRejectedValue(new Error('pdf.js is not available in node'));
});
afterEach(() => {
  mock.restore();
});

describe('prepareArtwork raster', () => {
  it('EXIF orientation 6: a stored 600x400 JPEG comes out 400 x 600, upright, without EXIF', async () => {
    const r = await prepareArtwork(source(fx('exif6-600x400.jpg'), 'jpeg', { px: [400, 600], hasAlpha: false }), rect(40, 60), 300);
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect([a.pxWidth, a.pxHeight]).toEqual([400, 600]);
    expect(a.mime).toBe('image/jpeg');
    expect(a.hasAlpha).toBe(false);
    const d = await decoded(a.bytes);
    expect([d.width, d.height, d.meta.format]).toEqual([400, 600, 'jpeg']);
    expect(d.meta.orientation ?? 1).toBe(1);
    expect(r.effectiveDpi).toBeCloseTo(400 / (40 / 25.4), 6);
    expect(a.effectiveDpi).toBe(r.effectiveDpi);
    expect(mock.bitmaps.every((b) => b.closed)).toBe(true);
  });

  it('a 4000 px PNG for a 2 cm sticker at 300 DPI comes out 236 px on the long side', async () => {
    const big = new Uint8Array(
      await sharp({ create: { width: 4000, height: 4000, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } })
        .png()
        .toBuffer(),
    );
    const r = await prepareArtwork(source(big, 'png', { px: [4000, 4000], hasAlpha: true }), rect(20, 20), 300);
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(Math.max(a.pxWidth, a.pxHeight)).toBe(236);
    expect([a.pxWidth, a.pxHeight]).toEqual([236, 236]);
    expect(a.mime).toBe('image/png');
    const d = await decoded(a.bytes);
    expect([d.width, d.height, d.meta.format, d.meta.hasAlpha]).toEqual([236, 236, 'png', true]);
    expect(r.effectiveDpi).toBeCloseTo(4000 / (20 / 25.4), 6);
  });

  it('never scales up', async () => {
    const r = await prepareArtwork(source(fx('opaque-300x300.jpg'), 'jpeg', { px: [300, 300], hasAlpha: false }), rect(50, 50), 300);
    if (!r.ok) throw new Error(r.error);
    expect([r.artwork.kind === 'raster' && r.artwork.pxWidth, r.artwork.kind === 'raster' && r.artwork.pxHeight]).toEqual([300, 300]);
  });

  it('custom shape: the padded PNG is cropped to its trim box, pixel for pixel like the server', async () => {
    const png = fx('padded-400x400.png');
    const full = await decoded(png);
    const trim = alphaBoundingBox(full.pixels, full.width, full.height, ALPHA_THRESHOLD);
    if (!trim) throw new Error('fixture has no alpha box');
    expect([trim.width, trim.height]).toEqual([200, 100]);
    const spec = custom(50, 25);
    const r = await prepareArtwork(source(png, 'png', { px: [trim.width, trim.height], hasAlpha: true, trim }), spec, 300);
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect([a.pxWidth, a.pxHeight, a.mime, a.hasAlpha]).toEqual([200, 100, 'image/png', true]);
    expect(r.effectiveDpi).toBeCloseTo(200 / (50 / 25.4), 6);

    const s = await normaliseArtwork(png, { spec, targetDpi: 300, blockDpi: 72 });
    if (!s.ok) throw new Error(s.error);
    const sa = raster(s.artwork);
    expect((await decoded(a.bytes)).pixels.equals((await decoded(sa.bytes)).pixels)).toBe(true);
  });

  it('custom shape: crops to the alpha box even when the source was decoded for another shape (no trim)', async () => {
    const png = fx('padded-400x400.png');
    const r = await prepareArtwork(source(png, 'png', { px: [400, 400], hasAlpha: true }), custom(50, 25), 300);
    if (!r.ok) throw new Error(r.error);
    expect([raster(r.artwork).pxWidth, raster(r.artwork).pxHeight]).toEqual([200, 100]);
  });

  it('custom shape without transparency, or from a PDF, is no_alpha', async () => {
    expect(await prepareArtwork(source(fx('opaque-300x300.jpg'), 'jpeg', { px: [300, 300], hasAlpha: false }), custom(30, 30), 300)).toEqual({
      ok: false,
      error: 'no_alpha',
    });
    expect(await prepareArtwork(source(fx('two-page.pdf'), 'pdf', { px: [200, 100], hasAlpha: false }), custom(30, 30), 300)).toEqual({
      ok: false,
      error: 'no_alpha',
    });
    const opaquePng = new Uint8Array(await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer());
    expect(await prepareArtwork(source(opaquePng, 'png', { px: [50, 50], hasAlpha: false }), custom(30, 30), 300)).toEqual({ ok: false, error: 'no_alpha' });
  });

  it('a CMYK JPEG is re-encoded as an sRGB JPEG (normal colours), never passed through', async () => {
    const cmyk = new Uint8Array(
      await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .toColourspace('cmyk')
        .jpeg({ quality: 95 })
        .toBuffer(),
    );
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const r = await prepareArtwork(source(cmyk, 'jpeg', { px: [120, 80], hasAlpha: false }), rect(12, 8), 300);
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(a.mime).toBe('image/jpeg');
    const meta = await sharp(a.bytes).metadata();
    expect([meta.space, meta.channels, meta.width, meta.height]).toEqual(['srgb', 3, 120, 80]);
    const { data } = await sharp(a.bytes).raw().toBuffer({ resolveWithObject: true });
    const [rr, gg, bb] = [data[0], data[1], data[2]];
    expect(rr).toBeGreaterThan(150);
    expect(gg).toBeLessThan(100);
    expect(bb).toBeLessThan(100);
  });

  it('matches the server on size, mime, alpha and effective DPI', async () => {
    const cases: [string, DesignSource['kind'], StickerSpec, boolean][] = [
      ['exif6-600x400.jpg', 'jpeg', rect(40, 60), false],
      ['exif6-600x400.jpg', 'jpeg', rect(20, 30), false],
      ['exif6-600x400.jpg', 'jpeg', circle(30), false],
      ['exif6-600x400.jpg', 'jpeg', rect(10, 10), false],
      ['opaque-300x300.jpg', 'jpeg', rect(25, 25), false],
      ['opaque-300x300.jpg', 'jpeg', circle(30), false],
      ['padded-400x400.png', 'png', rect(20, 20), true],
      ['padded-400x400.png', 'png', circle(30), true],
      ['padded-400x400.png', 'png', custom(10, 5), true],
    ];
    for (const [name, kind, spec, hasAlpha] of cases) {
      const bytes = fx(name);
      const s = await normaliseArtwork(bytes, { spec, targetDpi: 300, blockDpi: 1 });
      if (!s.ok) throw new Error(`${name}: server ${s.error}`);
      const r = await prepareArtwork(source(bytes, kind, { px: [s.pxWidth, s.pxHeight], hasAlpha }), spec, 300);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      const a = raster(r.artwork);
      const sa = raster(s.artwork);
      expect({ name, px: [a.pxWidth, a.pxHeight], mime: a.mime, hasAlpha: a.hasAlpha, dpi: a.effectiveDpi }).toEqual({
        name,
        px: [sa.pxWidth, sa.pxHeight],
        mime: sa.mime,
        hasAlpha: sa.hasAlpha,
        dpi: sa.effectiveDpi,
      });
    }
  });

  it('a file the browser cannot decode is corrupt', async () => {
    const junk = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
    expect(await prepareArtwork(source(junk, 'png', { px: [10, 10], hasAlpha: false }), rect(10, 10), 300)).toEqual({ ok: false, error: 'corrupt' });
  });
});

describe('prepareArtwork pdf', () => {
  it('returns the original bytes with the server box and rotate (CropBox, /Rotate 90)', async () => {
    const bytes = fx('cropbox-rot90.pdf');
    const r = await prepareArtwork(source(bytes, 'pdf', { px: [300, 400], hasAlpha: false }), rect(30, 40), 300);
    if (!r.ok) throw new Error(r.error);
    expect(r.effectiveDpi).toBeNull();
    if (r.artwork.kind !== 'pdf') throw new Error('expected a pdf artwork');
    const s = await normaliseArtwork(bytes, { spec: rect(30, 40), targetDpi: 300, blockDpi: 72 });
    if (!s.ok || s.artwork.kind !== 'pdf') throw new Error('server failed');
    expect({ kind: r.artwork.kind, box: r.artwork.box, rotate: r.artwork.rotate, pageCount: r.artwork.pageCount }).toEqual({
      kind: 'pdf',
      box: s.artwork.box,
      rotate: s.artwork.rotate,
      pageCount: s.artwork.pageCount,
    });
    expect(r.artwork.box).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    expect(r.artwork.rotate).toBe(90);
    expect(Buffer.from(r.artwork.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(Object.keys(r.artwork).join(',')).toBe(Object.keys(s.artwork).join(','));
  });

  it('two-page.pdf: page 1 box, page count 2', async () => {
    const r = await prepareArtwork(source(fx('two-page.pdf'), 'pdf', { px: [200, 100], hasAlpha: false }), circle(30), 300);
    if (!r.ok || r.artwork.kind !== 'pdf') throw new Error('expected a pdf artwork');
    expect([r.artwork.box, r.artwork.rotate, r.artwork.pageCount]).toEqual([{ x: 0, y: 0, width: 200, height: 100 }, 0, 2]);
  });

  it('an encrypted PDF is encrypted', async () => {
    expect(await prepareArtwork(source(fx('encrypted-marker.pdf'), 'pdf', { px: [100, 100], hasAlpha: false }), rect(30, 30), 300)).toEqual({
      ok: false,
      error: 'encrypted',
    });
  });

  const junkPdf = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf at all\n%%EOF');

  it('an unreadable PDF that cannot be rasterised either is corrupt', async () => {
    expect(await prepareArtwork(source(junkPdf, 'pdf', { px: [100, 100], hasAlpha: false }), rect(30, 30), 300)).toEqual({ ok: false, error: 'corrupt' });
    expect(rasterise).toHaveBeenCalledTimes(1);
  });

  it('a PDF pdf-lib cannot load is rasterised at the target DPI and continues as a raster design', async () => {
    const page = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#336699' } }).png().toBuffer();
    rasterise.mockResolvedValue(new Blob([new Uint8Array(page)], { type: 'image/png' }));
    const r = await prepareArtwork(source(junkPdf, 'pdf', { px: [100, 100], hasAlpha: false }), rect(60, 40), 300);
    if (!r.ok) throw new Error(r.error);
    expect(rasterise).toHaveBeenCalledWith(expect.any(File), 300);
    const a = raster(r.artwork);
    expect([a.mime, a.pxWidth, a.pxHeight, a.hasAlpha]).toEqual(['image/jpeg', 600, 400, false]);
  });

  it('a PDF with an empty box is rasterised too', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).setMediaBox(0, 0, 0, 0);
    const bytes = new Uint8Array(await doc.save());
    const page = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer();
    rasterise.mockResolvedValue(new Blob([new Uint8Array(page)], { type: 'image/png' }));
    const r = await prepareArtwork(source(bytes, 'pdf', { px: [200, 200], hasAlpha: false }), rect(30, 30), 300);
    if (!r.ok) throw new Error(r.error);
    expect(r.artwork.kind).toBe('raster');
  });

  it('an encrypted PDF is never rasterised', async () => {
    await prepareArtwork(source(fx('encrypted-marker.pdf'), 'pdf', { px: [100, 100], hasAlpha: false }), rect(30, 30), 300);
    expect(rasterise).not.toHaveBeenCalled();
  });
});

describe('downscaleSteps', () => {
  it('halves while more than 2x too big, like before', () => {
    expect(downscaleSteps(4000, 3000, 1000, 750)).toEqual([[2000, 1500]]);
    expect(downscaleSteps(4001, 3001, 1000, 750)).toEqual([[2001, 1501], [1001, 751]]);
    expect(downscaleSteps(1500, 1000, 1000, 700)).toEqual([]);
  });

  it('never makes a canvas above the pixel cap, even when the first halving step would', () => {
    const steps = downscaleSteps(20_000, 20_000, 2_000, 2_000);
    expect(Math.ceil(20_000 / 2) ** 2).toBeGreaterThan(MAX_CANVAS_PIXELS);
    expect(steps.length).toBeGreaterThan(1);
    for (const [w, h] of steps) expect(w * h).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    // The first step is the largest scale that fits, and sizes keep shrinking.
    expect(steps[0][0] * steps[0][1]).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
    const last = steps[steps.length - 1];
    expect(last[0] <= 4_000 && last[1] <= 4_000).toBe(true);
  });
});
