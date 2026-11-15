/**
 * prepareRaster's final canvas at 1200 DPI: a browser that cannot make a canvas of the full print
 * size (iOS Safari above MAX_CANVAS_PIXELS: getContext returns null) gets the same artwork one size
 * down; a browser that can keeps the full size. MAX_CANVAS_PIXELS is lowered to 250,000 here (mock
 * of ./pixels) so the test does not need 17-megapixel buffers.
 */
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CAP = 250_000;
vi.mock('@/lib/design/pixels', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/design/pixels')>()), MAX_CANVAS_PIXELS: 250_000 }));

import { prepareArtwork } from '@/lib/design/prepare.client';
import type { DesignSource, StickerSpec } from '@/lib/types';
import { PRINT_DPI } from '@/lib/print-dpi';
import { installBrowserMock, type BrowserMock, type MockCanvas } from './browser-mock';

const rect = (wMm: number, hMm: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: wMm * 1000, heightUm: hMm * 1000 });

async function source(w: number, h: number): Promise<DesignSource> {
  const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
  return { kind: 'jpeg', file: new File([new Uint8Array(bytes)], 'd.jpg', { type: 'image/jpeg' }), pxWidth: w, pxHeight: h, hasAlpha: false, previewUrl: 'blob:p' };
}

let mock: BrowserMock;
/** Canvases ever asked for, in order, as `width x height` at the time getContext was called. */
let asked: { w: number; h: number; refused: boolean }[];

/** The mock browser, but a canvas above CAP pixels has no 2d context (like iOS Safari above its limit). */
function limitCanvases() {
  const doc = (globalThis as unknown as { document: { createElement(t: string): MockCanvas } }).document;
  const original = doc.createElement.bind(doc);
  vi.stubGlobal('document', {
    createElement(tag: string) {
      const c = original(tag);
      const getContext = c.getContext.bind(c);
      c.getContext = (kind: string) => {
        const refused = c.width * c.height > CAP;
        asked.push({ w: c.width, h: c.height, refused });
        return refused ? null : getContext(kind);
      };
      return c;
    },
  });
}

beforeEach(() => {
  mock = installBrowserMock();
  asked = [];
});
afterEach(() => mock.restore());

describe('prepareRaster final canvas cap', () => {
  it('retries one size down, aspect kept, when the browser refuses the full-size canvas', async () => {
    limitCanvases();
    // 1000x600 = 600,000 px > CAP, and at 1200 DPI a 10 cm sticker needs more than the source has: no resample.
    const out = await prepareArtwork(await source(1000, 600), rect(100, 60), PRINT_DPI);
    if (!out.ok || out.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    const { pxWidth: w, pxHeight: h } = out.artwork;
    expect(w * h).toBeLessThanOrEqual(CAP);
    expect(w * h).toBeGreaterThan(CAP * 0.98);
    expect(Math.abs(w / h - 1000 / 600)).toBeLessThan(0.01);
    const meta = await sharp(out.artwork.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([w, h]);
    // the full-size attempt came first and was refused; the retry was not
    expect(asked[0]).toEqual({ w: 1000, h: 600, refused: true });
    expect(asked.at(-1)?.refused).toBe(false);
    // effective DPI still describes the ORIGINAL pixels
    expect(out.effectiveDpi).toBeCloseTo(1000 / (100 / 25.4), 5);
  });

  it('keeps the full print size when the browser can make the canvas', async () => {
    limitCanvases();
    const out = await prepareArtwork(await source(400, 400), rect(100, 100), PRINT_DPI); // 160,000 px <= CAP
    if (!out.ok || out.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect([out.artwork.pxWidth, out.artwork.pxHeight]).toEqual([400, 400]);
    expect(asked.some((a) => a.refused)).toBe(false);
  });

  it('keeps full size on a browser with no limit, however big (desktop does not lose 1200 DPI)', async () => {
    // no limitCanvases(): the mock makes any canvas
    const out = await prepareArtwork(await source(1000, 600), rect(100, 60), PRINT_DPI);
    if (!out.ok || out.artwork.kind !== 'raster') throw new Error('expected a raster artwork');
    expect([out.artwork.pxWidth, out.artwork.pxHeight]).toEqual([1000, 600]);
  });

  it('a failure on a canvas that already fits the cap is not retried (reported as corrupt)', async () => {
    const original = (globalThis as unknown as { document: { createElement(t: string): MockCanvas } }).document;
    const make = original.createElement.bind(original);
    vi.stubGlobal('document', {
      createElement(tag: string) {
        const c = make(tag);
        c.getContext = () => null; // every canvas refused
        return c;
      },
    });
    const out = await prepareArtwork(await source(400, 400), rect(100, 100), PRINT_DPI);
    expect(out).toEqual({ ok: false, error: 'corrupt' });
  });
});
