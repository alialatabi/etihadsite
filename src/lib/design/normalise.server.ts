import 'server-only';
/**
 * Server-side artwork normalisation. Node only (sharp, pdf-lib).
 *
 * Contract (docs/PLAN.md §3):
 *  - Detect type by MAGIC BYTES, not by the client's MIME.
 *  - Raster: sharp EXIF auto-orient; for shape 'custom' trim to the alpha box
 *    (alpha > 8, same helper as the browser) and FAIL with 'no_alpha' when there
 *    is no transparency; CMYK -> sRGB; resample to the ordered size at targetDpi
 *    (never upscale beyond the original); PNG when alpha else JPEG q92.
 *    effectiveDpi uses the ORIGINAL oriented (trimmed) pixels over spec.widthUm.
 *  - PDF: pdf-lib load (no ignoreEncryption -> 'encrypted'); page 1;
 *    box = TrimBox ?? CropBox ?? MediaBox; rotate = page /Rotate.
 *    Unparseable but not encrypted -> 'needs_raster'.
 *  - Quality gate: effectiveDpi < blockDpi -> 'low_dpi' (rasters only).
 *
 * Outer pxWidth/pxHeight: rasters = oriented, trimmed ORIGINAL pixels; PDFs = box
 * in exact (unrounded) points, AFTER /Rotate (swapped for 90/270) so the aspect equals the
 * viewer/pdfjs one. `artwork.box` is the raw, unrotated box (what embedPage needs).
 */
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { effectiveDpi, pxForUmAtDpi } from '@/lib/units';
import type { DesignKind, NormalisedArtwork, OrderError, StickerSpec } from '@/lib/types';
import { sniffKind } from './kind';
import { ALPHA_THRESHOLD, alphaBoundingBox, hasAnyAlpha, widthPixelsFor } from './pixels';

// Kept importable from here for existing callers and tests.
export { sniffKind } from './kind';

export interface NormaliseOptions {
  spec: StickerSpec;
  targetDpi: number;
  blockDpi: number;
}

type Fail = Extract<OrderError, 'unsupported_type' | 'corrupt' | 'encrypted' | 'no_alpha' | 'low_dpi' | 'needs_raster'>;

export type NormaliseOutcome =
  | { ok: true; artwork: NormalisedArtwork; pxWidth: number; pxHeight: number; kind: DesignKind }
  | { ok: false; error: Fail };

const fail = (error: Fail): NormaliseOutcome => ({ ok: false, error });

export async function normaliseArtwork(bytes: Uint8Array, opts: NormaliseOptions): Promise<NormaliseOutcome> {
  const kind = sniffKind(bytes);
  if (!kind) return fail('unsupported_type');
  if (kind === 'pdf') return normalisePdf(bytes);
  try {
    return await normaliseRaster(bytes, opts);
  } catch {
    return fail('corrupt');
  }
}

async function normaliseRaster(bytes: Uint8Array, opts: NormaliseOptions): Promise<NormaliseOutcome> {
  const { spec, targetDpi, blockDpi } = opts;
  const meta = await sharp(bytes).metadata();
  const channelHasAlpha = meta.hasAlpha === true;
  if (spec.shape === 'custom' && !channelHasAlpha) return fail('no_alpha');

  // Stage 1: oriented (EXIF), sRGB, 8-bit raw pixels.
  let pipe = sharp(bytes).rotate().toColorspace('srgb');
  pipe = channelHasAlpha ? pipe.ensureAlpha() : pipe.removeAlpha();
  const channels = channelHasAlpha ? 4 : 3;
  const { data, info } = await pipe.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  let width = info.width;
  let height = info.height;
  let pixels: Buffer = data;
  let hasAlpha = false;

  if (channelHasAlpha) {
    hasAlpha = hasAnyAlpha(pixels, width, height);
    if (spec.shape === 'custom') {
      if (!hasAlpha) return fail('no_alpha');
      const box = alphaBoundingBox(pixels, width, height, ALPHA_THRESHOLD);
      if (!box) return fail('corrupt');
      if (box.width !== width || box.height !== height) {
        pixels = await sharp(pixels, { raw: { width, height, channels: 4 } })
          .extract(box)
          .raw()
          .toBuffer();
        width = box.width;
        height = box.height;
      }
    }
  }

  // A circle is centre-cropped to the shorter side of the artwork (matches the client).
  const dpi = effectiveDpi(widthPixelsFor(spec.shape, width, height), spec.widthUm);
  if (dpi < blockDpi) return fail('low_dpi');

  // Resample to the print resolution; never upscale.
  const targetW = pxForUmAtDpi(spec.widthUm, targetDpi);
  const targetH = pxForUmAtDpi(spec.heightUm, targetDpi);
  const scale = Math.min(1, Math.max(targetW / width, targetH / height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  let out = sharp(pixels, { raw: { width, height, channels } });
  if (channels === 4 && !hasAlpha) out = out.removeAlpha();
  if (scale < 1) out = out.resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' });
  const encoded = hasAlpha
    ? await out.png({ compressionLevel: 9 }).toBuffer()
    : await out.jpeg({ quality: 92 }).toBuffer();

  const artwork: NormalisedArtwork = {
    kind: 'raster',
    bytes: new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength),
    mime: hasAlpha ? 'image/png' : 'image/jpeg',
    pxWidth: outW,
    pxHeight: outH,
    hasAlpha,
    effectiveDpi: dpi,
  };
  return { ok: true, artwork, pxWidth: width, pxHeight: height, kind: hasAlpha ? 'png' : 'jpeg' };
}

// instanceof is unreliable when pdf-lib is loaded through both its CJS and ESM builds.
function isEncryptedError(e: unknown): boolean {
  return e instanceof Error && (e.constructor.name === 'EncryptedPDFError' || /is encrypted/i.test(e.message));
}

async function normalisePdf(bytes: Uint8Array): Promise<NormaliseOutcome> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes); // never ignoreEncryption
  } catch (e) {
    if (isEncryptedError(e)) return fail('encrypted');
    return fail('needs_raster');
  }
  try {
    const pageCount = doc.getPageCount();
    if (pageCount < 1) return fail('corrupt');
    const page = doc.getPage(0);
    const b = page.node.TrimBox() ? page.getTrimBox() : page.getCropBox(); // CropBox falls back to MediaBox
    const box = { x: b.x, y: b.y, width: b.width, height: b.height };
    if (!(box.width > 0) || !(box.height > 0)) return fail('needs_raster');
    const raw = Math.round(page.getRotation().angle / 90) * 90;
    const rotate = ((((raw % 360) + 360) % 360) as 0 | 90 | 180 | 270);
    const swap = rotate === 90 || rotate === 270;
    return {
      ok: true,
      artwork: { kind: 'pdf', bytes, box, rotate, pageCount },
      pxWidth: swap ? box.height : box.width,
      pxHeight: swap ? box.width : box.height,
      kind: 'pdf',
    };
  } catch {
    return fail('needs_raster');
  }
}
