/**
 * Print resolution (owner decision, 2026-11-15): every layout is printed at PRINT_DPI = 1200, a fixed
 * MAXIMUM. A raster sharper than that at the ordered size is resampled DOWN to exactly 1200 DPI, a
 * raster below it is kept as it is (never upscaled). Covers the server normaliser, the browser's
 * prepareArtwork and the pure canvas-cap helpers.
 */
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { MAX_CANVAS_PIXELS, fitToPixelCap, pdfRenderScale } from '@/lib/design/pixels';
import { prepareArtwork } from '@/lib/design/prepare.client';
import type { DesignSource, StickerSpec } from '@/lib/types';
import { PRINT_DPI } from '@/lib/print-dpi';
import { pxForUmAtDpi } from '@/lib/units';
import { installBrowserMock, type BrowserMock } from './browser-mock';

const rect = (wMm: number, hMm: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: wMm * 1000, heightUm: hMm * 1000 });
const circle = (dMm: number): StickerSpec => ({ shape: 'circle', widthUm: dMm * 1000, heightUm: dMm * 1000 });

/** A solid opaque JPEG of the given size (sharp makes it without a fixture file). */
const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 20 } } })
    .jpeg({ quality: 80 })
    .toBuffer()
    .then((b) => new Uint8Array(b));

describe('PRINT_DPI', () => {
  it('is 1200', () => {
    expect(PRINT_DPI).toBe(1200);
  });

  it('is 2362 px for 5 cm', () => {
    expect(pxForUmAtDpi(50_000, PRINT_DPI)).toBe(Math.round((5 / 2.54) * 1200));
    expect(pxForUmAtDpi(50_000, PRINT_DPI)).toBe(2362);
  });
});

describe('server normaliseArtwork at PRINT_DPI', () => {
  const opts = (spec: StickerSpec) => ({ spec, targetDpi: PRINT_DPI, blockDpi: 72 });

  it('a 3000x3000 source at a 5 cm square is resampled down to 2362 px', async () => {
    const r = await normaliseArtwork(await jpeg(3000, 3000), opts(rect(50, 50)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect([r.artwork.pxWidth, r.artwork.pxHeight]).toEqual([2362, 2362]);
    const m = await sharp(r.artwork.bytes).metadata();
    expect([m.width, m.height]).toEqual([2362, 2362]);
  });

  it('a 3000x3000 source at a 5 cm circle is resampled down to 2362 px', async () => {
    const r = await normaliseArtwork(await jpeg(3000, 3000), opts(circle(50)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect([r.artwork.pxWidth, r.artwork.pxHeight]).toEqual([2362, 2362]);
  });

  it('a 900x900 source at 3 cm stays 900 px (never upscaled)', async () => {
    const r = await normaliseArtwork(await jpeg(900, 900), opts(rect(30, 30)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect(pxForUmAtDpi(30_000, PRINT_DPI)).toBeGreaterThan(900);
    expect([r.artwork.pxWidth, r.artwork.pxHeight]).toEqual([900, 900]);
    const m = await sharp(r.artwork.bytes).metadata();
    expect([m.width, m.height]).toEqual([900, 900]);
  });
});

describe('browser prepareArtwork at PRINT_DPI', () => {
  let mock: BrowserMock;
  beforeEach(() => {
    mock = installBrowserMock();
  });
  afterEach(() => mock.restore());

  const source = async (w: number, h: number): Promise<DesignSource> => ({
    kind: 'jpeg',
    file: new File([await jpeg(w, h)], 'design.jpg', { type: 'image/jpeg' }),
    pxWidth: w,
    pxHeight: h,
    hasAlpha: false,
    previewUrl: 'blob:preview',
  });

  it('resamples down to exactly 1200 DPI at the ordered size (2 cm -> 945 px)', async () => {
    const out = await prepareArtwork(await source(1500, 1500), rect(20, 20), PRINT_DPI);
    if (!out.ok || out.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect(pxForUmAtDpi(20_000, PRINT_DPI)).toBe(945);
    expect([out.artwork.pxWidth, out.artwork.pxHeight]).toEqual([945, 945]);
  });

  it('keeps a raster below 1200 DPI as it is (never upscaled)', async () => {
    const out = await prepareArtwork(await source(600, 600), rect(30, 30), PRINT_DPI);
    if (!out.ok || out.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect([out.artwork.pxWidth, out.artwork.pxHeight]).toEqual([600, 600]);
  });
});

describe('fitToPixelCap', () => {
  it('leaves a size that fits alone', () => {
    expect(fitToPixelCap(4000, 4000, MAX_CANVAS_PIXELS)).toEqual({ width: 4000, height: 4000 });
    expect(fitToPixelCap(4096, 4096)).toEqual({ width: 4096, height: 4096 }); // exactly the cap
  });

  it('scales a too-big size down, aspect kept, to at most the cap', () => {
    const r = fitToPixelCap(8000, 6000, MAX_CANVAS_PIXELS);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(r.width * r.height).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
    expect(Math.abs(r.width / r.height - 8000 / 6000)).toBeLessThan(0.001);
  });

  it('A4 at 1200 DPI (9921 x 14031) fits the cap', () => {
    const r = fitToPixelCap(9921, 14031);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(r.width).toBeLessThan(9921);
  });

  it('never returns a side below 1, even for a thin strip', () => {
    const r = fitToPixelCap(1, 100_000_000, 1000);
    expect(r.width).toBe(1);
    expect(r.width * r.height).toBeLessThanOrEqual(1000);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe('pdfRenderScale', () => {
  const LIMITS = { maxSide: 12_000, maxPixels: MAX_CANVAS_PIXELS };
  const canvasOf = (w: number, h: number, s: number) => [Math.round(w * s), Math.round(h * s)] as const;
  const A4 = [595.2756, 841.8898] as const;

  it('without a target: a small box is rendered at the plain dpi / 72', () => {
    // 5 cm box = 141.7 pt: 1200 DPI -> 2362 px, well under both caps
    const s = pdfRenderScale(141.7323, 141.7323, 1200, undefined, LIMITS);
    expect(s).toBeCloseTo(1200 / 72, 9);
  });

  it('without a target: an A4 box at 1200 DPI is capped by area, never above the canvas limit', () => {
    const s = pdfRenderScale(A4[0], A4[1], 1200, undefined, LIMITS);
    const [w, h] = canvasOf(A4[0], A4[1], s);
    expect(w * h).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(Math.max(w, h)).toBeLessThanOrEqual(12_000);
    expect(s).toBeLessThan(1200 / 72);
  });

  it('with the ordered sticker: an A4 page for a 5 cm sticker is rendered at the sticker size, 1200 DPI', () => {
    const s = pdfRenderScale(A4[0], A4[1], 1200, { widthUm: 50_000, heightUm: 70_000 }, LIMITS);
    const [w, h] = canvasOf(A4[0], A4[1], s);
    // the page is scaled so its width covers 5 cm and its height 7 cm at 1200 DPI (the larger wins)
    expect(h).toBeGreaterThanOrEqual(pxForUmAtDpi(70_000, 1200) - 1);
    expect(w * h).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
  });

  it('a long side above the side cap lowers the scale', () => {
    const s = pdfRenderScale(100, 10_000, 72, undefined, { maxSide: 5_000, maxPixels: 1e12 });
    expect(Math.round(10_000 * s)).toBeLessThanOrEqual(5_000);
  });

  it('the rounded canvas never exceeds the pixel cap, whatever the box', () => {
    for (const [w, h] of [[300.3, 411.7], [841.9, 1190.55], [12.5, 2000.1], [1999.9, 1999.9]] as const) {
      const s = pdfRenderScale(w, h, 1200, undefined, { maxSide: 12_000, maxPixels: 4_000_000 });
      const [cw, ch] = canvasOf(w, h, s);
      expect(Math.max(1, cw) * Math.max(1, ch)).toBeLessThanOrEqual(4_000_000);
    }
  });
});
