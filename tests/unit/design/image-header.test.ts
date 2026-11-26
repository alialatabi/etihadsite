/** image-header.ts: pure PNG / JPEG header parsers (never throw; garbage or truncated -> null). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import { exifTurnCw, readJpegInfo, readPngInfo } from '@/lib/design/image-header';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const solid = { create: { width: 64, height: 48, channels: 3 as const, background: { r: 200, g: 40, b: 40 } } };
const bytesOf = async (s: Sharp) => new Uint8Array(await s.toBuffer());

/** `jpg` with one APP2 `ICC_PROFILE` segment right after SOI whose profile bytes are `payload` (text only: enough for the header reader and for pdf-lib / sharp to carry on). */
function withIccText(jpg: Uint8Array, payload: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1]), Buffer.from(payload)]);
  const head = Buffer.from([0xff, 0xe2, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  return new Uint8Array(Buffer.concat([Buffer.from(jpg.subarray(0, 2)), head, body, Buffer.from(jpg.subarray(2))]));
}
const latin1 = (t: string) => new Uint8Array(Buffer.from(t, 'latin1'));
/** ICC v4 `mluc` text: UTF-16 big endian. */
const utf16be = (t: string) => new Uint8Array(Buffer.from(t, 'utf16le').swap16());
/** `png` with an `iCCP` chunk named `name` (name, NUL, method 0, a zlib header: the header reader never inflates it). */
function withPngProfile(png: Uint8Array, name: string): Uint8Array {
  const data = Buffer.concat([Buffer.from(name, 'latin1'), Buffer.from([0, 0, 0x78, 0x9c])]);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write('iCCP', 4, 'ascii');
  return new Uint8Array(Buffer.concat([Buffer.from(png.subarray(0, 33)), head, data, Buffer.alloc(4), Buffer.from(png.subarray(33))]));
}

/** The orientation byte of the fixture's EXIF block set to `v` (little or big endian, entry 0x0112). */
function withOrientation(src: Uint8Array, v: number): Uint8Array {
  const b = new Uint8Array(src);
  for (let i = 2; i + 12 < b.length; i++) {
    const le = b[i] === 0x12 && b[i + 1] === 0x01 && b[i + 2] === 3 && b[i + 3] === 0;
    const be = b[i] === 0x01 && b[i + 1] === 0x12 && b[i + 2] === 0 && b[i + 3] === 3;
    if (le) {
      b[i + 8] = v;
      return b;
    }
    if (be) {
      b[i + 9] = v;
      return b;
    }
  }
  throw new Error('no orientation entry in fixture');
}

describe('readJpegInfo', () => {
  it('EXIF-6 fixture: stored 600x400, orientation 6, 3 components, baseline, no Adobe', () => {
    expect(readJpegInfo(fx('exif6-600x400.jpg'))).toMatchObject({ width: 600, height: 400, components: 3, bits: 8, sof: 0xc0, adobe: false, orientation: 6 });
  });

  it('plain fixture: 300x300, orientation 1 when there is no EXIF', () => {
    expect(readJpegInfo(fx('opaque-300x300.jpg'))).toMatchObject({ width: 300, height: 300, components: 3, bits: 8, orientation: 1 });
  });

  it('every EXIF orientation value is read back (also big-endian)', () => {
    const src = fx('exif6-600x400.jpg');
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) expect(readJpegInfo(withOrientation(src, v))?.orientation).toBe(v);
  });

  it('an out-of-range orientation counts as 1', () => {
    expect(readJpegInfo(withOrientation(fx('exif6-600x400.jpg'), 9))?.orientation).toBe(1);
  });

  it('a CMYK JPEG from sharp: 4 components with an Adobe APP14 marker', async () => {
    const jpg = await bytesOf(sharp(solid).toColourspace('cmyk').jpeg());
    expect(readJpegInfo(jpg)).toMatchObject({ width: 64, height: 48, components: 4, bits: 8, adobe: true });
  });

  it('a progressive JPEG is SOF2', async () => {
    const jpg = await bytesOf(sharp(solid).jpeg({ progressive: true }));
    expect(readJpegInfo(jpg)).toMatchObject({ width: 64, height: 48, sof: 0xc2, components: 3 });
  });

  it('a grayscale JPEG has 1 component', async () => {
    const jpg = await bytesOf(sharp(solid).toColourspace('b-w').jpeg());
    expect(readJpegInfo(jpg)?.components).toBe(1);
  });

  it('ICC: none without a profile; sRGB, unknown and generic profiles are not wide; only a wide-gamut name is', async () => {
    const plain = await bytesOf(sharp(solid).jpeg());
    expect(readJpegInfo(plain)?.icc).toBe('none');
    expect(readJpegInfo(await bytesOf(sharp(solid).withIccProfile('srgb').jpeg()))?.icc).toBe('srgb');
    expect(readJpegInfo(withIccText(plain, latin1('Some Vendor Monitor Profile')))?.icc).toBe('srgb');
    expect(readJpegInfo(withIccText(plain, utf16be('Calibrated Studio Display')))?.icc).toBe('srgb');
    expect(readJpegInfo(withIccText(plain, latin1('sRGB IEC61966-2.1')))?.icc).toBe('srgb');
    // sharp's own compact Display P3 profile (description "sP3C")
    expect(readJpegInfo(await bytesOf(sharp(solid).withIccProfile('p3').jpeg()))?.icc).toBe('wide');
    for (const name of ['Display P3', 'DISPLAY P3', 'DCI-P3 D65', 'Adobe RGB (1998)', 'ProPhoto RGB', 'ROMM RGB', 'Rec. 2020', 'ITU-R BT.2020', 'Wide Gamut RGB']) {
      expect(readJpegInfo(withIccText(plain, latin1(name)))?.icc, `latin1 ${name}`).toBe('wide');
      expect(readJpegInfo(withIccText(plain, utf16be(name)))?.icc, `utf16 ${name}`).toBe('wide');
    }
  });

  it('a CMYK JPEG carrying an ICC profile: 4 components, Adobe marker and an APP2 profile', async () => {
    const jpg = await bytesOf(sharp(solid).toColourspace('cmyk').withIccProfile('cmyk').jpeg());
    const info = readJpegInfo(jpg);
    expect(info).toMatchObject({ components: 4, adobe: true });
    expect(info?.icc).not.toBe('none');
    expect(Buffer.from(jpg).includes('ICC_PROFILE')).toBe(true);
  });

  it('truncated inside the headers, garbage, empty and a PNG all give null', async () => {
    const src = fx('exif6-600x400.jpg');
    expect(readJpegInfo(src.subarray(0, 3))).toBeNull();
    expect(readJpegInfo(src.subarray(0, 30))).toBeNull();
    expect(readJpegInfo(src.subarray(0, 120))).toBeNull();
    expect(readJpegInfo(new Uint8Array(0))).toBeNull();
    expect(readJpegInfo(new Uint8Array(64).fill(7))).toBeNull();
    expect(readJpegInfo(fx('padded-400x400.png'))).toBeNull();
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]))).toBeNull();
  });

  it('never throws on every prefix of a real file', () => {
    const src = fx('exif6-600x400.jpg');
    for (let n = 0; n < 400; n++) expect(() => readJpegInfo(src.subarray(0, n))).not.toThrow();
  });
});

describe('readPngInfo', () => {
  it('RGB without alpha: colour type 2', async () => {
    const png = await bytesOf(sharp(solid).png());
    expect(readPngInfo(png)).toEqual({ width: 64, height: 48, bitDepth: 8, colorType: 2, hasExif: false, animated: false, icc: 'none' });
  });

  it('RGBA: colour type 6', async () => {
    const png = await bytesOf(sharp({ create: { width: 10, height: 20, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png());
    expect(readPngInfo(png)).toMatchObject({ width: 10, height: 20, colorType: 6, hasExif: false });
  });

  it('the repo fixture', () => {
    expect(readPngInfo(fx('padded-400x400.png'))).toMatchObject({ width: 400, height: 400 });
  });

  it('an eXIf chunk is found', async () => {
    const png = await bytesOf(sharp(solid).withExif({ IFD0: { Copyright: 'x' } }).png());
    expect(readPngInfo(png)?.hasExif).toBe(true);
  });

  it('iCCP: judged by the profile name; only a wide-gamut name is wide', async () => {
    const png = await bytesOf(sharp(solid).png());
    for (const name of ['sRGB IEC61966-2.1', 'Photoshop ICC profile', 'icc', 'ICC Profile', 'Some Vendor Monitor Profile']) {
      expect(readPngInfo(withPngProfile(png, name))?.icc, name).toBe('srgb');
    }
    for (const name of ['Display P3', 'display p3', 'DCI-P3', 'Adobe RGB (1998)', 'ProPhoto RGB', 'Rec.2020', 'BT.2020', 'ITU-R BT.2020', 'Wide Gamut RGB', 'ROMM RGB']) {
      expect(readPngInfo(withPngProfile(png, name))?.icc, name).toBe('wide');
    }
  });

  it('truncated, garbage and a JPEG give null', async () => {
    const png = await bytesOf(sharp(solid).png());
    expect(readPngInfo(png.subarray(0, 20))).toBeNull();
    expect(readPngInfo(png.subarray(0, 8))).toBeNull();
    expect(readPngInfo(new Uint8Array(0))).toBeNull();
    expect(readPngInfo(new Uint8Array(100).fill(3))).toBeNull();
    expect(readPngInfo(fx('exif6-600x400.jpg'))).toBeNull();
    for (let n = 0; n < 100; n++) expect(() => readPngInfo(png.subarray(0, n))).not.toThrow();
  });
});

describe('exifTurnCw', () => {
  it('maps the upright and turned orientations, null for the mirrored ones', () => {
    expect([1, 3, 6, 8].map(exifTurnCw)).toEqual([0, 180, 90, 270]);
    expect([2, 4, 5, 7, 0, 9].map(exifTurnCw)).toEqual([null, null, null, null, null, null]);
  });
});
