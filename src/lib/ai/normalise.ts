import 'server-only';
/**
 * Pixel clean-up around the image model (sharp).
 *
 * normaliseGenerated — the model's PNGs have "opaque" pixels at alpha 253–254 (never 255) and fully
 * transparent pixels with dark RGB. The site's decode treats any alpha < 255 as "has alpha", so:
 *  - circle, rect: flatten onto white → opaque RGB PNG (the PDF's circle clip cuts the circle);
 *  - custom: alpha ≥ 250 → 255; alpha ≤ 8 → 0 with RGB white; soft edges (9–249) unchanged; RGBA PNG.
 *
 * extendToAspect — a rectangle longer than AI_MAX_ASPECT : 1 is drawn by the model at AI_MAX_ASPECT : 1; this grows it
 * along its long axis, equally on both ends, by repeating the edge pixels, until it has the sticker's real ratio.
 *
 * prepareRef — a customer's reference image before it goes to OpenAI: EXIF auto-orient, fit inside
 * AI_REF_LONG_SIDE (never enlarge), metadata stripped (sharp drops it unless asked to keep it),
 * PNG when it has an alpha channel, else JPEG q85. Throws on undecodable input (the route maps it).
 */
import sharp from 'sharp';
import type { Shape } from '../types';
import { AI_MAX_ASPECT, AI_MAX_EXTENDED_SIDE, AI_REF_LONG_SIDE } from './config';
import type { ImageRef } from './openai';

const OPAQUE_FROM = 250;
const CLEAR_UPTO = 8;
/** Decompression-bomb guard on every input: a refused image throws before it is decoded. */
const INPUT = { limitInputPixels: 40_000_000 } as const;

export async function normaliseGenerated(
  png: Uint8Array,
  shape: Shape,
): Promise<{ png: Uint8Array; pxWidth: number; pxHeight: number }> {
  if (shape !== 'custom') {
    const { data, info } = await sharp(png, INPUT)
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: new Uint8Array(data), pxWidth: info.width, pxHeight: info.height };
  }

  const { data, info } = await sharp(png, INPUT)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('normaliseGenerated: expected 4 channels');
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a >= OPAQUE_FROM) {
      data[i + 3] = 255;
    } else if (a <= CLEAR_UPTO) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 0;
    }
  }
  const out = await sharp(data, { ...INPUT, raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
  return { png: new Uint8Array(out), pxWidth: info.width, pxHeight: info.height };
}

/**
 * Extends `png` (opaque, from normaliseGenerated) along its long axis to `aspect` (long side : short side of the
 * sticker), equally on both ends, repeating the edge pixels (`extendWith: 'copy'`). The short side keeps its pixels.
 * Unchanged (same bytes) when `aspect` is at most AI_MAX_ASPECT or the image is already that long. The long side stops
 * at `maxSidePx`. Returns the real pixel size.
 */
export async function extendToAspect(
  png: Uint8Array,
  aspect: number,
  maxSidePx: number = AI_MAX_EXTENDED_SIDE,
): Promise<{ png: Uint8Array; pxWidth: number; pxHeight: number }> {
  const { width = 0, height = 0 } = await sharp(png, INPUT).metadata();
  if (width < 1 || height < 1) throw new Error('extendToAspect: unreadable image');
  const unchanged = { png, pxWidth: width, pxHeight: height };
  if (!(aspect > AI_MAX_ASPECT)) return unchanged;
  const landscape = width >= height;
  const short = landscape ? height : width;
  const long = landscape ? width : height;
  const target = Math.min(Math.round(short * aspect), maxSidePx);
  if (target <= long) return unchanged;
  const before = Math.floor((target - long) / 2);
  const after = target - long - before;
  const pad = landscape
    ? { top: 0, bottom: 0, left: before, right: after }
    : { left: 0, right: 0, top: before, bottom: after };
  const { data, info } = await sharp(png, INPUT)
    .extend({ ...pad, extendWith: 'copy' })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: new Uint8Array(data), pxWidth: info.width, pxHeight: info.height };
}

export async function prepareRef(bytes: Uint8Array): Promise<ImageRef> {
  const { hasAlpha } = await sharp(bytes, INPUT).metadata();
  const pipeline = sharp(bytes, INPUT)
    .rotate()
    .resize({ width: AI_REF_LONG_SIDE, height: AI_REF_LONG_SIDE, fit: 'inside', withoutEnlargement: true });
  if (hasAlpha) {
    return { bytes: new Uint8Array(await pipeline.png().toBuffer()), mime: 'image/png' };
  }
  return { bytes: new Uint8Array(await pipeline.jpeg({ quality: 85 }).toBuffer()), mime: 'image/jpeg' };
}
