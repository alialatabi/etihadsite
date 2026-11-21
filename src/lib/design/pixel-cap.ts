/**
 * Pixel cap for a raster design (PNG / JPEG). Pure (no sharp), so the check logic is testable
 * without decoding a huge image. A full A4 at 1200 DPI is 9921 x 14031 = about 139.2 MP, the
 * largest legitimate print case, so the cap sits just above it. The cap protects the server
 * (sharp decodes to raw RGBA: 4 bytes per pixel), not the customer's print quality.
 */
export const MAX_INPUT_PIXELS = 150_000_000;

/** True when width x height is a real, positive pixel count within MAX_INPUT_PIXELS. */
export function pixelsWithinCap(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height || width < 1 || height < 1) return false;
  return width * height <= MAX_INPUT_PIXELS;
}

/** True when the header's pixel count is OVER the cap. Missing dimensions count as 0 (not over): the decoder then decides. */
export function pixelsOverCap(width: number | undefined, height: number | undefined): boolean {
  return (width ?? 0) * (height ?? 0) > MAX_INPUT_PIXELS;
}
