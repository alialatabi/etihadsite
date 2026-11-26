/**
 * Header parsers for PNG and JPEG files. Pure and isomorphic (no DOM, no node, no sharp): the
 * staff page reads them in the browser to decide whether a file's ORIGINAL bytes can go into the
 * print PDF unchanged (see original.client.ts). They never throw: truncated or garbage input
 * gives `null`. Only the headers are read, never the pixels.
 */

export interface JpegInfo {
  /** Stored (unrotated) size from the SOF segment. */
  width: number;
  height: number;
  /** 1 gray, 3 YCbCr/RGB, 4 CMYK/YCCK. */
  components: number;
  /** Sample precision (8 for every normal JPEG). */
  bits: number;
  /** SOF marker byte (0xC0 baseline, 0xC1 extended, 0xC2 progressive, ...). */
  sof: number;
  /** An Adobe APP14 marker is present (CMYK files that carry it are stored inverted). */
  adobe: boolean;
  /** EXIF orientation 1..8; 1 when absent or invalid. */
  orientation: number;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** An `eXIf` chunk is present (an orientation the browser may apply and pdf-lib would not). */
  hasExif: boolean;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Orientation tag (0x0112) of IFD0 of a TIFF block (`Exif\0\0` already skipped); 1 when absent or unreadable. */
function tiffOrientation(b: Uint8Array, start: number, end: number): number {
  if (end - start < 8) return 1;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  const big = b[start] === 0x4d && b[start + 1] === 0x4d;
  if (!little && !big) return 1;
  const r16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const r32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : u32be(b, o));
  if (r16(start + 2) !== 0x2a) return 1;
  const ifd = start + r32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (r16(entry) !== 0x0112) continue;
    if (r16(entry + 2) !== 3) return 1; // not a SHORT
    const v = r16(entry + 8);
    return v >= 1 && v <= 8 ? v : 1;
  }
  return 1;
}

/** Start-of-frame markers that carry the size (every 0xC0-0xCF except DHT 0xC4, JPG 0xC8, DAC 0xCC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  try {
    const n = bytes.length;
    if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let sof: { marker: number; bits: number; width: number; height: number; components: number } | null = null;
    let adobe = false;
    let orientation = 1;
    let sawExif = false;
    let p = 2;
    while (p < n) {
      if (bytes[p] !== 0xff) return null; // lost sync: not a header we can trust
      while (p < n && bytes[p] === 0xff) p++; // fill bytes
      if (p >= n) return null;
      const marker = bytes[p++];
      if (marker === 0xd9) break; // EOI before any scan
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length
      if (p + 2 > n) return null;
      const len = u16be(bytes, p);
      if (len < 2 || p + len > n) return null; // truncated segment
      const body = p + 2;
      const bodyEnd = p + len;
      if (isSof(marker)) {
        if (len < 8) return null;
        const components = bytes[body + 5];
        if (len < 8 + components * 3) return null;
        sof = { marker, bits: bytes[body], height: u16be(bytes, body + 1), width: u16be(bytes, body + 3), components };
      } else if (marker === 0xe1 && !sawExif && len >= 8 && bytes[body] === 0x45 && bytes[body + 1] === 0x78 && bytes[body + 2] === 0x69 && bytes[body + 3] === 0x66 && bytes[body + 4] === 0 && bytes[body + 5] === 0) {
        sawExif = true;
        orientation = tiffOrientation(bytes, body + 6, bodyEnd);
      } else if (marker === 0xee && len >= 7 && bytes[body] === 0x41 && bytes[body + 1] === 0x64 && bytes[body + 2] === 0x6f && bytes[body + 3] === 0x62 && bytes[body + 4] === 0x65) {
        adobe = true;
      }
      p = bodyEnd;
      if (marker === 0xda) break; // SOS: the headers are done
    }
    if (!sof || sof.width < 1 || sof.height < 1) return null;
    return { width: sof.width, height: sof.height, components: sof.components, bits: sof.bits, sof: sof.marker, adobe, orientation };
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function readPngInfo(bytes: Uint8Array): PngInfo | null {
  try {
    const n = bytes.length;
    if (n < 33) return null;
    for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
    // IHDR: length 13, then the type, then width, height, bit depth, colour type.
    if (u32be(bytes, 8) !== 13 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    if (width < 1 || height < 1) return null;
    const bitDepth = bytes[24];
    const colorType = bytes[25];
    let hasExif = false;
    let p = 33; // after IHDR + its CRC
    while (p + 8 <= n) {
      const len = u32be(bytes, p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (type === 'eXIf') {
        hasExif = true;
        break;
      }
      if (type === 'IEND') break;
      p += 12 + len;
    }
    return { width, height, bitDepth, colorType, hasExif };
  } catch {
    return null;
  }
}

/** Clockwise turn (degrees) that makes an EXIF-oriented image upright; null for the mirrored orientations (2, 4, 5, 7) and anything else. */
export function exifTurnCw(orientation: number): 0 | 90 | 180 | 270 | null {
  switch (orientation) {
    case 1:
      return 0;
    case 3:
      return 180;
    case 6:
      return 90;
    case 8:
      return 270;
    default:
      return null;
  }
}
