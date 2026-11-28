import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import { extendToAspect, normaliseGenerated, prepareRef } from '@/lib/ai/normalise';

/**
 * 4×4 RGBA like the image model returns: "opaque" pixels at alpha 253, the corner (0,0) fully
 * transparent with dark RGB, pixel (1,0) at alpha 5 (near-transparent), pixel (2,0) at alpha 120
 * (a soft edge, left alone).
 */
async function syntheticPng(): Promise<Uint8Array> {
  const w = 4;
  const h = 4;
  const raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    raw[i * 4] = 200;
    raw[i * 4 + 1] = 40;
    raw[i * 4 + 2] = 60;
    raw[i * 4 + 3] = 253;
  }
  raw.set([10, 10, 10, 0], 0); // (0,0) transparent, dark RGB
  raw.set([20, 20, 20, 5], 4); // (1,0) alpha 5
  raw.set([200, 40, 60, 120], 8); // (2,0) alpha 120
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}

async function rawOf(png: Uint8Array) {
  return sharp(png).raw().toBuffer({ resolveWithObject: true });
}

describe('normaliseGenerated', () => {
  it('alpha 253 becomes 255 for custom', async () => {
    const out = await normaliseGenerated(await syntheticPng(), 'custom');
    expect(out.pxWidth).toBe(4);
    expect(out.pxHeight).toBe(4);
    expect(out.png).toBeInstanceOf(Uint8Array);
    const { data, info } = await rawOf(out.png);
    expect(info.channels).toBe(4);
    const px = (x: number, y: number) => Array.from(data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 255, 255, 0]);
    expect(px(1, 0)).toEqual([255, 255, 255, 0]);
    expect(px(2, 0)).toEqual([200, 40, 60, 120]);
    expect(px(3, 3)).toEqual([200, 40, 60, 255]);
    for (let i = 3; i < data.length; i += 4) expect([0, 120, 255]).toContain(data[i]);
  });

  it('circle is flattened to opaque white', async () => {
    const out = await normaliseGenerated(await syntheticPng(), 'circle');
    const { data, info } = await rawOf(out.png);
    expect(info.channels).toBe(3);
    expect((await sharp(out.png).metadata()).hasAlpha).toBe(false);
    expect(Array.from(data.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(out.pxWidth).toBe(4);
    expect(out.pxHeight).toBe(4);
  });

  it('rect is opaque', async () => {
    const out = await normaliseGenerated(await syntheticPng(), 'rect');
    const meta = await sharp(out.png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(false);
    expect(meta.channels).toBe(3);
  });
});

/** A tiny valid PNG whose IHDR claims 8000×8000 (64 MP > the 40 MP limit); CRC recomputed. */
async function oversizedPng(): Promise<Uint8Array> {
  const png = Buffer.from(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer());
  // Signature (8) + length (4) + "IHDR" (4) → width at 16, height at 20; CRC over type+data at 29.
  png.writeUInt32BE(8000, 16);
  png.writeUInt32BE(8000, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return new Uint8Array(png);
}

describe('pixel limit', () => {
  it('an oversized-dimension image is rejected (throws)', async () => {
    const bomb = await oversizedPng();
    expect((await sharp(bomb, { limitInputPixels: false }).metadata()).width).toBe(8000);
    await expect(prepareRef(bomb)).rejects.toThrow(/pixel limit/i);
    await expect(normaliseGenerated(bomb, 'custom')).rejects.toThrow(/pixel limit/i);
    await expect(normaliseGenerated(bomb, 'circle')).rejects.toThrow(/pixel limit/i);
  });
});

describe('prepareRef', () => {
  it('prepareRef shrinks a 3000 px JPEG to 1024 and drops EXIF', async () => {
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 30, g: 120, b: 200 } } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'customer phone 07701234567' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const before = await sharp(jpeg).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const ref = await prepareRef(new Uint8Array(jpeg));
    expect(ref.mime).toBe('image/jpeg');
    const meta = await sharp(ref.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    // Orientation 6 = rotated 90°: 3000×2000 becomes portrait 2000×3000, then fits in 1024.
    expect(meta.height).toBe(1024);
    expect(meta.width).toBe(683);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('keeps PNG with alpha and never enlarges', async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer();
    const ref = await prepareRef(new Uint8Array(png));
    expect(ref.mime).toBe('image/png');
    const meta = await sharp(ref.bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.hasAlpha).toBe(true);
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });
});

/** An opaque w x h RGB png whose column x (landscape) or row y (portrait) has a distinct grey, so copies are visible. */
async function stripedPng(w: number, h: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = w >= h ? (x * 7 + 10) % 250 : (y * 7 + 10) % 250;
      raw.set([v, v, v], (y * w + x) * 3);
    }
  }
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
}

describe('extendToAspect', () => {
  it('landscape: grows the width equally on both sides to the real ratio, height unchanged', async () => {
    const out = await extendToAspect(await stripedPng(30, 10), 9);
    expect(out.pxHeight).toBe(10);
    expect(out.pxWidth).toBe(90);
    const { data, info } = await rawOf(out.png);
    expect([info.width, info.height, info.channels]).toEqual([90, 10, 3]);
    const px = (x: number, y: number) => data[(y * 90 + x) * 3];
    // 30 to 90: 30 added on each side; the original sits in columns 30..59.
    expect(px(30, 4)).toBe((0 * 7 + 10) % 250);
    expect(px(59, 4)).toBe((29 * 7 + 10) % 250);
    // The edge pixels are copied outwards.
    expect(px(0, 4)).toBe(px(30, 4));
    expect(px(29, 4)).toBe(px(30, 4));
    expect(px(89, 4)).toBe(px(59, 4));
    expect(px(60, 4)).toBe(px(59, 4));
  });

  it('portrait: grows the height (top and bottom), width unchanged; an odd padding gives the extra row to the end', async () => {
    const out = await extendToAspect(await stripedPng(10, 30), 9.1);
    expect(out.pxWidth).toBe(10);
    expect(out.pxHeight).toBe(91);
    const { data } = await rawOf(out.png);
    const px = (y: number) => data[(y * 10 + 3) * 3];
    // 61 added: 30 on top, 31 at the bottom.
    expect(px(30)).toBe((0 * 7 + 10) % 250);
    expect(px(0)).toBe(px(30));
    expect(px(90)).toBe(px(59));
  });

  it('a ratio of at most 3 (or an image already long enough) is returned untouched', async () => {
    const src = await stripedPng(30, 10);
    const same = await extendToAspect(src, 3);
    expect(same.png).toBe(src);
    expect([same.pxWidth, same.pxHeight]).toEqual([30, 10]);
    const tiny = await extendToAspect(src, 2);
    expect(tiny.png).toBe(src);
    const already = await extendToAspect(src, 3.0001);
    expect(already.pxWidth).toBe(30);
  });

  it('the long side stops at the maximum', async () => {
    const out = await extendToAspect(await stripedPng(30, 10), 400, 200);
    expect([out.pxWidth, out.pxHeight]).toEqual([200, 10]);
  });

  it('a 28 x 1 cm sticker drawn at 3:1 (1424x480) becomes 13440 x 480', async () => {
    const src = new Uint8Array(await sharp({ create: { width: 1424, height: 480, channels: 3, background: '#33aa55' } }).png().toBuffer());
    const out = await extendToAspect(src, 28);
    expect([out.pxWidth, out.pxHeight]).toEqual([13_440, 480]);
    expect((await sharp(out.png).metadata()).hasAlpha).toBe(false);
  });
});
