/**
 * prepareOriginalArtwork (src/lib/design/original.client.ts): the staff page's artwork at the
 * uploaded file's own bytes, colours and resolution. Browser image APIs come from ./browser-mock.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOriginalArtwork } from '@/lib/design/original.client';
import { prepareArtwork } from '@/lib/design/prepare.client';
import { PRINT_DPI } from '@/lib/print-dpi';
import type { DesignSource, NormalisedArtwork, PixelBox, StickerSpec } from '@/lib/types';
const rasterise = vi.hoisted(() => vi.fn());
vi.mock('@/lib/design/decode.client', () => ({ rasterisePdfPage: rasterise }));

import { installBrowserMock, type BrowserMock } from './browser-mock';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const rect = (wMm: number, hMm: number): StickerSpec => ({ shape: 'rect', corners: 'sharp', widthUm: wMm * 1000, heightUm: hMm * 1000 });
const circle = (dMm: number): StickerSpec => ({ shape: 'circle', widthUm: dMm * 1000, heightUm: dMm * 1000 });
const custom = (wMm: number, hMm: number): StickerSpec => ({ shape: 'custom', widthUm: wMm * 1000, heightUm: hMm * 1000 });
const MIME = { png: 'image/png', jpeg: 'image/jpeg', pdf: 'application/pdf' } as const;

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

const raster = (a: NormalisedArtwork) => {
  if (a.kind !== 'raster') throw new Error('expected a raster artwork');
  return a;
};
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const solid = (w: number, h: number) => ({ create: { width: w, height: h, channels: 3 as const, background: { r: 30, g: 120, b: 200 } } });
const jpegOf = async (s: Sharp) => new Uint8Array(await s.jpeg().toBuffer());

/** A copy of the EXIF fixture with its orientation set to `v`. */
function withOrientation(src: Uint8Array, v: number): Uint8Array {
  const b = new Uint8Array(src);
  for (let i = 2; i + 12 < b.length; i++) {
    if (b[i] === 0x12 && b[i + 1] === 0x01 && b[i + 2] === 3 && b[i + 3] === 0) {
      b[i + 8] = v;
      return b;
    }
    if (b[i] === 0x01 && b[i + 1] === 0x12 && b[i + 2] === 0 && b[i + 3] === 3) {
      b[i + 9] = v;
      return b;
    }
  }
  throw new Error('no orientation entry');
}

let mock: BrowserMock;
beforeEach(() => {
  mock = installBrowserMock();
  rasterise.mockReset();
  rasterise.mockRejectedValue(new Error('pdf.js is not available in node'));
});
afterEach(() => {
  mock.restore();
});

describe('prepareOriginalArtwork JPEG', () => {
  it('an RGB JPEG: the bytes of the file, untouched, no canvas', async () => {
    const bytes = fx('opaque-300x300.jpg');
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [300, 300], hasAlpha: false }), rect(30, 30));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(same(a.bytes, bytes)).toBe(true);
    expect([a.mime, a.pxWidth, a.pxHeight, a.hasAlpha, a.rotate]).toEqual(['image/jpeg', 300, 300, false, undefined]);
    expect(r.effectiveDpi).toBeCloseTo(300 / (30 / 25.4), 6);
    expect(a.effectiveDpi).toBe(r.effectiveDpi);
    expect(mock.canvases).toHaveLength(0);
    expect(mock.bitmaps).toHaveLength(0);
  });

  it('a CMYK JPEG with an Adobe marker: bytes identical (colours stay CMYK)', async () => {
    const bytes = await jpegOf(sharp(solid(120, 80)).toColourspace('cmyk'));
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [120, 80], hasAlpha: false }), rect(60, 40));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(true);
    expect(mock.canvases).toHaveLength(0);
  });

  it('a progressive JPEG keeps its bytes', async () => {
    const bytes = new Uint8Array(await sharp(solid(90, 60)).jpeg({ progressive: true }).toBuffer());
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [90, 60], hasAlpha: false }), rect(45, 30));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(true);
  });

  it('EXIF 6: the stored 600x400 bytes with rotate 90 (the source is the oriented 400x600)', async () => {
    const bytes = fx('exif6-600x400.jpg');
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [400, 600], hasAlpha: false }), rect(40, 60));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(same(a.bytes, bytes)).toBe(true);
    expect([a.pxWidth, a.pxHeight, a.rotate]).toEqual([600, 400, 90]);
    expect(r.effectiveDpi).toBeCloseTo(400 / (40 / 25.4), 6); // oriented pixels over the ordered width
    expect(mock.canvases).toHaveLength(0);
  });

  it('EXIF 3 and 8 give rotate 180 and 270', async () => {
    const src = fx('exif6-600x400.jpg');
    const three = await prepareOriginalArtwork(source(withOrientation(src, 3), 'jpeg', { px: [600, 400], hasAlpha: false }), rect(60, 40));
    const eight = await prepareOriginalArtwork(source(withOrientation(src, 8), 'jpeg', { px: [400, 600], hasAlpha: false }), rect(40, 60));
    if (!three.ok || !eight.ok) throw new Error('prepare failed');
    expect(raster(three.artwork).rotate).toBe(180);
    expect(raster(eight.artwork).rotate).toBe(270);
  });

  it('a mirrored EXIF (2) falls back to the canvas path (re-encoded, upright, no rotate)', async () => {
    const bytes = withOrientation(fx('exif6-600x400.jpg'), 2);
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [600, 400], hasAlpha: false }), rect(60, 40));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(same(a.bytes, bytes)).toBe(false);
    expect(a.rotate).toBeUndefined();
    expect([a.pxWidth, a.pxHeight]).toEqual([600, 400]); // native resolution kept
    expect(mock.canvases.length).toBeGreaterThan(0);
  });

  it('a JPEG whose size does not match the decoded source falls back', async () => {
    const bytes = fx('opaque-300x300.jpg');
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [299, 300], hasAlpha: false }), rect(30, 30));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(false);
  });

  it('a CMYK JPEG without an Adobe marker falls back', async () => {
    const bytes = await jpegOf(sharp(solid(40, 40)).toColourspace('cmyk'));
    const plain = new Uint8Array(bytes);
    for (let i = 2; i + 5 < plain.length; i++) {
      if (plain[i] === 0xff && plain[i + 1] === 0xee && plain[i + 4] === 0x41) plain[i + 1] = 0xe5; // APP14 -> APP5
    }
    expect(same(plain, bytes)).toBe(false);
    const r = await prepareOriginalArtwork(source(plain, 'jpeg', { px: [40, 40], hasAlpha: false }), rect(20, 20));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, plain)).toBe(false);
  });

  it('a 4000 x 4000 JPEG at 2 cm keeps 4000 px (no 1200 dpi cap)', async () => {
    const bytes = await jpegOf(sharp(solid(4000, 4000)));
    const r = await prepareOriginalArtwork(source(bytes, 'jpeg', { px: [4000, 4000], hasAlpha: false }), rect(20, 20));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect([a.pxWidth, a.pxHeight]).toEqual([4000, 4000]);
    expect(same(a.bytes, bytes)).toBe(true);
    expect(r.effectiveDpi).toBeCloseTo(4000 / (20 / 25.4), 3);
    expect(r.effectiveDpi).toBeGreaterThan(PRINT_DPI);
  });

  it('shape custom on a JPEG is refused like on the website: no_alpha', async () => {
    const r = await prepareOriginalArtwork(source(fx('opaque-300x300.jpg'), 'jpeg', { px: [300, 300], hasAlpha: false }), custom(30, 30));
    expect(r).toEqual({ ok: false, error: 'no_alpha' });
  });

  it('a JPEG with a 0xFF fill byte after SOI (pdf-lib cannot parse it) falls back to the canvas path', async () => {
    const plain = await jpegOf(sharp(solid(40, 20)));
    const filled = new Uint8Array(plain.length + 1);
    filled.set(plain.subarray(0, 2), 0);
    filled[2] = 0xff;
    filled.set(plain.subarray(2), 3);
    const r = await prepareOriginalArtwork(source(filled, 'jpeg', { px: [40, 20], hasAlpha: false }), rect(40, 20));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, filled)).toBe(false);
    expect(mock.canvases.length).toBeGreaterThan(0);
  });

  it('an RGB JPEG with a wide-gamut ICC profile falls back (pdf-lib would drop the profile); an sRGB profile keeps the bytes', async () => {
    const p3 = new Uint8Array(await sharp(solid(40, 20)).withIccProfile('p3').jpeg().toBuffer());
    const srgb = new Uint8Array(await sharp(solid(40, 20)).withIccProfile('srgb').jpeg().toBuffer());
    const a = await prepareOriginalArtwork(source(p3, 'jpeg', { px: [40, 20], hasAlpha: false }), rect(40, 20));
    const b = await prepareOriginalArtwork(source(srgb, 'jpeg', { px: [40, 20], hasAlpha: false }), rect(40, 20));
    if (!a.ok || !b.ok) throw new Error('prepare failed');
    expect(same(raster(a.artwork).bytes, p3)).toBe(false);
    expect(same(raster(b.artwork).bytes, srgb)).toBe(true);
  });

  it('a file that is not a JPEG at all: corrupt (from the canvas path)', async () => {
    const r = await prepareOriginalArtwork(source(new Uint8Array(64).fill(9), 'jpeg', { px: [10, 10], hasAlpha: false }), rect(10, 10));
    expect(r).toEqual({ ok: false, error: 'corrupt' });
  });
});

describe('prepareOriginalArtwork PNG', () => {
  it('the original bytes of a PNG with alpha', async () => {
    const bytes = fx('padded-400x400.png');
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [400, 400], hasAlpha: true }), rect(40, 40));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect(same(a.bytes, bytes)).toBe(true);
    expect([a.mime, a.pxWidth, a.pxHeight, a.hasAlpha, a.rotate]).toEqual(['image/png', 400, 400, true, undefined]);
    expect(mock.canvases).toHaveLength(0);
  });

  it('a 4000 x 4000 PNG at 2 cm keeps 4000 px', async () => {
    const bytes = new Uint8Array(await sharp(solid(4000, 4000)).png({ compressionLevel: 1 }).toBuffer());
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [4000, 4000], hasAlpha: false }), circle(20));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect([a.pxWidth, a.pxHeight]).toEqual([4000, 4000]);
    expect(same(a.bytes, bytes)).toBe(true);
  });

  it('a PNG over the canvas pixel cap goes the fallback way (not embedded as it is)', async () => {
    const bytes = new Uint8Array(await sharp(solid(4200, 4000)).png({ compressionLevel: 1 }).toBuffer()); // 16.8 MP
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [4200, 4000], hasAlpha: false }), rect(100, 100));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(false);
  });

  it('a PNG with an eXIf chunk falls back', async () => {
    const bytes = new Uint8Array(await sharp(solid(50, 40)).withExif({ IFD0: { Copyright: 'x' } }).png().toBuffer());
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [50, 40], hasAlpha: false }), rect(50, 40));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(false);
  });

  it('an animated PNG (acTL chunk) falls back: pdf-lib refuses to embed it', async () => {
    const plain = new Uint8Array(await sharp(solid(4, 4)).png().toBuffer());
    const actl = Buffer.alloc(20); // length 8, 'acTL', frames 2, plays 0, crc (not checked by the header reader)
    actl.writeUInt32BE(8, 0);
    actl.write('acTL', 4, 'ascii');
    actl.writeUInt32BE(2, 8);
    const apng = new Uint8Array(Buffer.concat([Buffer.from(plain.subarray(0, 33)), actl, Buffer.from(plain.subarray(33))]));
    const r = await prepareOriginalArtwork(source(apng, 'png', { px: [4, 4], hasAlpha: false }), rect(4, 4));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, apng)).toBe(false);
  });

  it('a PNG with a non-sRGB iCCP profile falls back; one named sRGB keeps the bytes', async () => {
    const plain = new Uint8Array(await sharp(solid(40, 20)).png().toBuffer());
    const withProfile = (name: string) => {
      const data = Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from([0, 0, 0x78, 0x9c])]); // name, NUL, method 0, a zlib header (not inflated by the header reader)
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write('iCCP', 4, 'ascii');
      return new Uint8Array(Buffer.concat([Buffer.from(plain.subarray(0, 33)), head, data, Buffer.alloc(4), Buffer.from(plain.subarray(33))]));
    };
    const p3 = withProfile('Display P3');
    const srgb = withProfile('sRGB IEC61966-2.1');
    const a = await prepareOriginalArtwork(source(p3, 'png', { px: [40, 20], hasAlpha: false }), rect(40, 20));
    const b = await prepareOriginalArtwork(source(srgb, 'png', { px: [40, 20], hasAlpha: false }), rect(40, 20));
    if (!a.ok || !b.ok) throw new Error('prepare failed');
    expect(same(raster(a.artwork).bytes, p3)).toBe(false);
    expect(same(raster(b.artwork).bytes, srgb)).toBe(true);
  });

  it('custom shape with a trim box: canvas crop at native resolution (crop size == trim size, above 1200 dpi)', async () => {
    const bytes = new Uint8Array(await sharp({ create: { width: 2000, height: 2000, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }).png().toBuffer());
    const trim = { left: 100, top: 150, width: 1800, height: 1700 };
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [1800, 1700], hasAlpha: true, trim }), custom(10, 10));
    if (!r.ok) throw new Error(r.error);
    const a = raster(r.artwork);
    expect([a.pxWidth, a.pxHeight]).toEqual([1800, 1700]);
    expect(a.mime).toBe('image/png');
    expect(same(a.bytes, bytes)).toBe(false);
    expect(r.effectiveDpi).toBeCloseTo(1800 / (10 / 25.4), 3);
  });

  it('custom shape whose trim is the whole image keeps the original bytes', async () => {
    const bytes = fx('padded-400x400.png');
    const trim = { left: 0, top: 0, width: 400, height: 400 };
    const r = await prepareOriginalArtwork(source(bytes, 'png', { px: [400, 400], hasAlpha: true, trim }), custom(40, 40));
    if (!r.ok) throw new Error(r.error);
    expect(same(raster(r.artwork).bytes, bytes)).toBe(true);
  });
});

describe('prepareOriginalArtwork PDF', () => {
  it('is exactly prepareArtwork at PRINT_DPI (original bytes, page 1 box and turn)', async () => {
    const bytes = fx('cropbox-rot90.pdf');
    const s = source(bytes, 'pdf', { px: [300, 400], hasAlpha: false });
    const mine = await prepareOriginalArtwork(s, rect(30, 40));
    const base = await prepareArtwork(s, rect(30, 40), PRINT_DPI);
    expect(mine).toEqual(base);
    expect(mine.ok && mine.artwork.kind).toBe('pdf');
  });

  it('a two-page PDF keeps its page count; custom shape stays no_alpha', async () => {
    const s = source(fx('two-page.pdf'), 'pdf', { px: [200, 100], hasAlpha: false });
    const r = await prepareOriginalArtwork(s, rect(40, 20));
    if (!r.ok || r.artwork.kind !== 'pdf') throw new Error('expected a pdf artwork');
    expect(r.artwork.pageCount).toBe(2);
    expect(await prepareOriginalArtwork(s, custom(40, 20))).toEqual({ ok: false, error: 'no_alpha' });
  });
});
