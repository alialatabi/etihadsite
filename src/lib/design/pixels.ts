/**
 * Pure pixel helpers shared by the browser decoder and the server normaliser,
 * so the preview and the printed artwork derive the SAME alpha box.
 * `data` is tightly packed RGBA (4 bytes per pixel).
 */

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

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

/** Scale (w, h) down so the long side is at most `maxLongSide`; never upscales. */
export function fitWithin(w: number, h: number, maxLongSide: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxLongSide) return { width: w, height: h };
  const k = maxLongSide / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
