'use client';
/**
 * Print-ready artwork made in the browser (staff page): the same result as the server's
 * `normaliseArtwork()` (normalise.server.ts) without sharp, so nothing is uploaded.
 *
 * Contract (docs/superpowers/specs/2026-11-12-cut-dots-and-staff-sheets-design.md, B3):
 *  - PNG/JPEG: createImageBitmap(file, { imageOrientation: 'from-image' }) (EXIF turn baked
 *    in, CMYK shown in normal colours by the browser). Shape 'custom': crop to `source.trim`
 *    (the alpha box decodeDesign found, alpha > 8), or find it with the same helper when the
 *    source was decoded for another shape; no transparency -> 'no_alpha'. Scale down (never
 *    up) with the server's rule for the ordered size at `targetDpi`; always re-encode (the
 *    original bytes may carry an EXIF turn or CMYK that pdf-lib would print as stored):
 *    PNG when the design has transparency, else JPEG at quality 0.92 on white.
 *    effectiveDpi uses the oriented, trimmed ORIGINAL pixels over spec.widthUm (a circle uses
 *    the shorter side), like the server. It is not a gate here: the caller decides.
 *  - PDF: the original bytes, page 1 box and turn from `pdfArtworkBox()` (shared with the
 *    server). Encrypted -> 'encrypted'; shape 'custom' -> 'no_alpha' (transparency in PDFs is
 *    not trusted, as in decodeDesign). A PDF that pdf-lib cannot load (and is not encrypted) or
 *    whose box is empty is rasterised (page 1, at the target DPI, like the website's
 *    `needs_raster` fallback) and continues as a raster design; if that fails too -> 'corrupt'.
 */
import { effectiveDpi as dpiOf, pxForUmAtDpi } from '@/lib/units';
import type { DesignSource, NormalisedArtwork, PixelBox, StickerSpec } from '@/lib/types';
import { isEncryptedPdfError, pdfArtworkBox } from './pdf-box';
import { scanAlphaStrips, widthPixelsFor } from './pixels';

export type PrepareError = 'encrypted' | 'corrupt' | 'no_alpha';

export type PrepareOutcome =
  | { ok: true; artwork: NormalisedArtwork; effectiveDpi: number | null }
  | { ok: false; error: PrepareError };

const JPEG_QUALITY = 0.92;
/** iOS Safari refuses a canvas above 16,777,216 pixels (getContext then returns null). */
export const MAX_CANVAS_PIXELS = 16_777_216;
const STRIP_ROWS = 256;

const fail = (error: PrepareError): PrepareOutcome => ({ ok: false, error });

export async function prepareArtwork(source: DesignSource, spec: StickerSpec, targetDpi: number): Promise<PrepareOutcome> {
  try {
    return source.kind === 'pdf'
      ? await preparePdf(source, spec, targetDpi)
      : await prepareRaster(source.file, source.hasAlpha, source.trim, spec, targetDpi);
  } catch {
    return fail('corrupt');
  }
}

/* ───────────────────────────────── raster ───────────────────────────────── */

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Frees a canvas' pixel memory now instead of at garbage collection (matters on phones). */
function release(c: HTMLCanvasElement): void {
  c.width = 0;
  c.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality);
  });
}

function context(canvas: HTMLCanvasElement, readBack = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Tight alpha box of the oriented bitmap, read in strips (same helper and threshold as decodeDesign and the server). */
function scanAlpha(bitmap: ImageBitmap): { hasAlpha: boolean; box: PixelBox | null } {
  const W = bitmap.width;
  const H = bitmap.height;
  const strip = makeCanvas(W, Math.min(STRIP_ROWS, H));
  const ctx = context(strip, true);
  try {
    return scanAlphaStrips(
      W,
      H,
      STRIP_ROWS,
      (y0, rows) => {
        ctx.clearRect(0, 0, W, strip.height);
        ctx.drawImage(bitmap, 0, y0, W, rows, 0, 0, W, rows);
        return ctx.getImageData(0, 0, W, rows).data;
      },
      true,
    );
  } finally {
    release(strip);
  }
}

const insideBitmap = (b: PixelBox, bitmap: ImageBitmap) =>
  Number.isInteger(b.left) && Number.isInteger(b.top) && Number.isInteger(b.width) && Number.isInteger(b.height) &&
  b.left >= 0 && b.top >= 0 && b.width >= 1 && b.height >= 1 && b.left + b.width <= bitmap.width && b.top + b.height <= bitmap.height;

/**
 * The canvas sizes to halve through, from a `sw` x `sh` region towards `outW` x `outH` (the
 * server's "halve while more than 2x too big" rule). No canvas is ever above `maxPixels`: when
 * the plain halving step would be, the step is drawn at the largest scale that fits the cap
 * instead, and halving carries on from there. Pure, so it is unit-tested without a DOM.
 */
export function downscaleSteps(sw: number, sh: number, outW: number, outH: number, maxPixels = MAX_CANVAS_PIXELS): [number, number][] {
  const steps: [number, number][] = [];
  while (sw > outW * 2 && sh > outH * 2) {
    let nw = Math.ceil(sw / 2);
    let nh = Math.ceil(sh / 2);
    if (nw * nh > maxPixels) {
      const k = Math.sqrt(maxPixels / (nw * nh));
      nw = Math.max(1, Math.floor(nw * k));
      nh = Math.max(1, Math.floor(nh * k));
      while (nw * nh > maxPixels) {
        if (nw >= nh) nw--;
        else nh--;
      }
    }
    steps.push([nw, nh]);
    sw = nw;
    sh = nh;
  }
  return steps;
}

async function prepareRaster(file: File, sourceHasAlpha: boolean, trim: PixelBox | undefined, spec: StickerSpec, targetDpi: number): Promise<PrepareOutcome> {
  if (spec.shape === 'custom' && !sourceHasAlpha) return fail('no_alpha');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width < 1 || bitmap.height < 1) return fail('corrupt');
    let hasAlpha = sourceHasAlpha;
    let region: PixelBox = { left: 0, top: 0, width: bitmap.width, height: bitmap.height };
    if (spec.shape === 'custom') {
      let box = trim && insideBitmap(trim, bitmap) ? trim : null;
      if (!box) {
        const scan = scanAlpha(bitmap);
        if (!scan.hasAlpha) return fail('no_alpha');
        hasAlpha = true;
        box = scan.box;
      }
      if (!box) return fail('corrupt'); // nothing above the alpha threshold
      region = box;
    }

    const dpi = dpiOf(widthPixelsFor(spec.shape, region.width, region.height), spec.widthUm);

    // The server's resample rule: fit the ordered size at targetDpi, never upscale.
    const targetW = pxForUmAtDpi(spec.widthUm, targetDpi);
    const targetH = pxForUmAtDpi(spec.heightUm, targetDpi);
    const scale = Math.min(1, Math.max(targetW / region.width, targetH / region.height));
    const outW = Math.max(1, Math.round(region.width * scale));
    const outH = Math.max(1, Math.round(region.height * scale));

    // Halve in steps while more than 2x too big: one big drawImage jump aliases in some browsers.
    // Every canvas stays under the browser's pixel cap (see downscaleSteps).
    let src: CanvasImageSource = bitmap;
    let step: HTMLCanvasElement | null = null;
    let { left: sx, top: sy, width: sw, height: sh } = region;
    let out: HTMLCanvasElement | null = null;
    let blob: Blob;
    try {
      for (const [nw, nh] of downscaleSteps(sw, sh, outW, outH)) {
        const next = makeCanvas(nw, nh);
        context(next).drawImage(src, sx, sy, sw, sh, 0, 0, nw, nh);
        if (step) release(step);
        step = next;
        src = next;
        [sx, sy, sw, sh] = [0, 0, nw, nh];
      }

      out = makeCanvas(outW, outH);
      const ctx = context(out);
      if (!hasAlpha) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
      }
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, outW, outH);
      if (step) release(step);
      step = null;
      blob = hasAlpha ? await toBlob(out, 'image/png') : await toBlob(out, 'image/jpeg', JPEG_QUALITY);
    } finally {
      if (step) release(step);
      if (out) release(out);
    }

    const artwork: NormalisedArtwork = {
      kind: 'raster',
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: hasAlpha ? 'image/png' : 'image/jpeg',
      pxWidth: outW,
      pxHeight: outH,
      hasAlpha,
      effectiveDpi: dpi,
    };
    return { ok: true, artwork, effectiveDpi: dpi };
  } finally {
    bitmap.close();
  }
}

/* ───────────────────────────────── PDF ───────────────────────────────── */

async function preparePdf(source: DesignSource, spec: StickerSpec, targetDpi: number): Promise<PrepareOutcome> {
  if (spec.shape === 'custom') return fail('no_alpha');
  const bytes = new Uint8Array(await source.file.arrayBuffer());
  const { PDFDocument } = await import('pdf-lib');
  let doc: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    doc = await PDFDocument.load(bytes); // never ignoreEncryption, as on the server
  } catch (e) {
    return isEncryptedPdfError(e) ? fail('encrypted') : rasterisedPdf(source.file, spec, targetDpi);
  }
  let a: ReturnType<typeof pdfArtworkBox> = null;
  try {
    a = pdfArtworkBox(doc);
  } catch {
    // a malformed page tree: treated like an empty box
  }
  if (!a) return rasterisedPdf(source.file, spec, targetDpi);
  return { ok: true, artwork: { kind: 'pdf', bytes, box: a.box, rotate: a.rotate, pageCount: a.pageCount }, effectiveDpi: null };
}

/** What the website does for a PDF the server cannot embed (`needs_raster`): page 1 as an image at the target DPI. */
async function rasterisedPdf(file: File, spec: StickerSpec, targetDpi: number): Promise<PrepareOutcome> {
  try {
    const { rasterisePdfPage } = await import('./decode.client');
    const blob = await rasterisePdfPage(file, targetDpi);
    const png = new File([blob], file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
    return await prepareRaster(png, false, undefined, spec, targetDpi); // rendered on white: no transparency
  } catch {
    return fail('corrupt');
  }
}
