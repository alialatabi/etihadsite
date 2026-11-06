'use client';
/**
 * Client-side design decoding — OWNED BY AGENT B. Browser only.
 *
 * Contract (docs/PLAN.md §3):
 *  - PNG/JPEG: decode via createImageBitmap(file, { imageOrientation: 'from-image' })
 *    so EXIF rotation is baked in; draw to a canvas; detect alpha; for shape
 *    'custom' compute the tight alpha bounding box (alpha > 8) and crop to it
 *    (fill `trim`); reject 'custom' without any transparent pixel → 'no_alpha'.
 *    pxWidth/pxHeight are the CROPPED, ORIENTED size. previewUrl is an object
 *    URL of a PNG (alpha) or JPEG (no alpha) re-encoded at ≤ 1600 px long side.
 *  - PDF: load with pdfjs-dist LEGACY build (`pdfjs-dist/legacy/build/pdf.mjs`),
 *    worker from /pdf.worker.min.mjs in /public, `isEvalSupported: false`.
 *    Use page 1. Size = viewport of the CropBox after /Rotate. Render at ~150 DPI
 *    for previewUrl. Encrypted → 'encrypted'. For shape 'custom' a PDF is
 *    rejected with 'no_alpha' (we cannot trust transparency in PDFs).
 *  - Unknown MIME / HEIC → 'unsupported_type'. > maxBytes → 'too_large'.
 *  - Never import pdfjs at module top level: dynamic import inside the function.
 */
import type { DesignDecodeOutcome, Shape } from '@/lib/types';

export interface DecodeOptions {
  shape: Shape;
  maxBytes: number;
}

export async function decodeDesign(file: File, opts: DecodeOptions): Promise<DesignDecodeOutcome> {
  void file;
  void opts;
  throw new Error('NOT_IMPLEMENTED: decodeDesign (Agent B)');
}

/**
 * Render page 1 of a PDF to a PNG Blob at `dpi` for the ordered physical size.
 * Used as the fallback when the server answers `needs_raster`.
 */
export async function rasterisePdfPage(file: File, dpi: number): Promise<Blob> {
  void file;
  void dpi;
  throw new Error('NOT_IMPLEMENTED: rasterisePdfPage (Agent B)');
}
