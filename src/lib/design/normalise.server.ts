import 'server-only';
/**
 * Server-side artwork normalisation — OWNED BY AGENT B. Node only (sharp, pdf-lib).
 *
 * Contract (docs/PLAN.md §3):
 *  - Detect type by MAGIC BYTES, not by the client's MIME.
 *  - Raster: sharp(bytes).rotate() (EXIF auto-orient); for shape 'custom' trim
 *    fully transparent borders (threshold alpha > 8) and FAIL with 'no_alpha' if
 *    the image has no alpha channel; CMYK → sRGB; resample to
 *    pxForUmAtDpi(cell, targetDpi) (never upscale beyond the original);
 *    output PNG when alpha else JPEG q92. effectiveDpi uses ORIGINAL pixels.
 *  - PDF: pdf-lib load (ignoreEncryption: false → 'encrypted' on failure);
 *    page 1; box = TrimBox ?? CropBox ?? MediaBox; rotate = page.getRotation().
 *    If pdf-lib cannot load/parse a PDF that is not encrypted → 'needs_raster'
 *    (the client will send a pdfjs raster instead).
 *  - Quality gate: effectiveDpi < blockDpi → 'low_dpi'.
 */
import type { NormalisedArtwork, OrderError, StickerSpec } from '@/lib/types';

export interface NormaliseOptions {
  spec: StickerSpec;
  targetDpi: number;
  blockDpi: number;
}

export type NormaliseOutcome =
  | { ok: true; artwork: NormalisedArtwork; pxWidth: number; pxHeight: number; kind: 'png' | 'jpeg' | 'pdf' }
  | { ok: false; error: Extract<OrderError, 'unsupported_type' | 'corrupt' | 'encrypted' | 'no_alpha' | 'low_dpi' | 'needs_raster'> };

export async function normaliseArtwork(bytes: Uint8Array, opts: NormaliseOptions): Promise<NormaliseOutcome> {
  void bytes;
  void opts;
  throw new Error('NOT_IMPLEMENTED: normaliseArtwork (Agent B)');
}

/** Sniff PNG / JPEG / PDF by magic bytes; null when unknown. Also used by /api/upload. */
export function sniffKind(bytes: Uint8Array): 'png' | 'jpeg' | 'pdf' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'pdf';
  return null;
}
