/**
 * Pure pixel helpers shared by the browser decoder and the server normaliser,
 * so the preview and the printed artwork derive the SAME alpha box.
 * `data` is tightly packed RGBA (4 bytes per pixel).
 */
import type { PixelBox, Shape } from '@/lib/types';

export type PixelRect = PixelBox;

/** Artwork pixels that span the ordered width: a circle is centre-cropped to the shorter side. */
export const widthPixelsFor = (shape: Shape, pxWidth: number, pxHeight: number) => (shape === 'circle' ? Math.min(pxWidth, pxHeight) : pxWidth);

/** Alpha threshold shared by client and server: alpha > 8 counts as content. */
export const ALPHA_THRESHOLD = 8;

/** Tight bounding box of pixels whose alpha is > threshold; null when none. */
export function alphaBoundingBox(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): PixelRect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** True when any pixel has alpha below `opaqueFrom` (default 255). */
export function hasAnyAlpha(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opaqueFrom = 255,
): boolean {
  const n = width * height * 4;
  for (let i = 3; i < n; i += 4) {
    if (data[i] < opaqueFrom) return true;
  }
  return false;
}

/**
 * Alpha scan of a `width` x `height` image read in horizontal strips of at most `stripRows`
 * rows (bounds memory on huge images). `readStrip(y0, rows)` returns the RGBA data of `rows`
 * rows starting at row `y0`. `hasAlpha` is hasAnyAlpha() of the whole image and `box` its
 * alphaBoundingBox() at ALPHA_THRESHOLD (null when nothing is above the threshold).
 * With `needBox` false the box is not computed: the scan stops at the first strip that has
 * alpha and `box` is the full image.
 */
export function scanAlphaStrips(
  width: number,
  height: number,
  stripRows: number,
  readStrip: (y0: number, rows: number) => Uint8Array | Uint8ClampedArray,
  needBox: boolean,
): { hasAlpha: boolean; box: PixelRect | null } {
  let hasAlpha = false;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y0 = 0; y0 < height; y0 += stripRows) {
    const rows = Math.min(stripRows, height - y0);
    const data = readStrip(y0, rows);
    if (!hasAlpha && hasAnyAlpha(data, width, rows)) hasAlpha = true;
    if (!needBox) {
      if (hasAlpha) break;
      continue;
    }
    const b = alphaBoundingBox(data, width, rows, ALPHA_THRESHOLD);
    if (b) {
      minX = Math.min(minX, b.left);
      maxX = Math.max(maxX, b.left + b.width - 1);
      minY = Math.min(minY, y0 + b.top);
      maxY = Math.max(maxY, y0 + b.top + b.height - 1);
    }
  }
  if (!needBox) return { hasAlpha, box: { left: 0, top: 0, width, height } };
  const box = maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { hasAlpha, box };
}

/** Scale (w, h) down so the long side is at most `maxLongSide`; never upscales. */
export function fitWithin(w: number, h: number, maxLongSide: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxLongSide) return { width: w, height: h };
  const k = maxLongSide / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
