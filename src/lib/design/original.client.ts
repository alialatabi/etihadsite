'use client';
/**
 * The staff page's artwork at the uploaded file's own resolution and colours (owner, 2026-11-26;
 * docs/superpowers/specs/2026-11-26-staff-original-art-and-receipts.md, Part A). The website and
 * its customer PDFs keep using `prepareArtwork(…, PRINT_DPI)`; only the staff PDFs come through here.
 *
 *  - PDF: unchanged (`prepareArtwork`: original bytes, page 1 as vector).
 *  - JPEG: the ORIGINAL bytes go into the PDF (a DCTDecode stream, CMYK kept as CMYK) when the
 *    header says pdf-lib embeds them faithfully (baseline/progressive, 8 bit, gray/RGB/CMYK with an
 *    Adobe marker, a non-mirrored EXIF turn that the drawer applies as `rotate`).
 *    Not for an RGB file with a non-sRGB ICC profile (pdf-lib would drop it) or one pdf-lib cannot parse.
 *  - PNG: the original bytes (pdf-lib re-compresses the pixels losslessly) unless a custom-shape
 *    crop is needed, an `eXIf` turn is present, it is animated (acTL), it has a non-sRGB iCCP profile, or the image is too big for pdf-lib's in-memory decode.
 *  - Anything else falls back to the canvas path with a dpi high enough that nothing is downscaled.
 */
import { PDFDocument } from 'pdf-lib';
import { PRINT_DPI } from '@/lib/print-dpi';
import { effectiveDpi as dpiOf, umToInch } from '@/lib/units';
import type { DesignSource, NormalisedArtwork, StickerSpec } from '@/lib/types';
import { exifTurnCw, readJpegInfo, readPngInfo } from './image-header';
import { MAX_CANVAS_PIXELS, widthPixelsFor } from './pixels';
import { prepareArtwork, type PrepareOutcome } from './prepare.client';

type Raster = Extract<NormalisedArtwork, { kind: 'raster' }>;

const ok = (artwork: Raster, dpi: number): PrepareOutcome => ({ ok: true, artwork, effectiveDpi: dpi });

/** The `prepareArtwork` dpi at which no raster of `pxW` x `pxH` is scaled down for `spec` (never below PRINT_DPI). */
function noDownscaleDpi(pxW: number, pxH: number, spec: StickerSpec): number {
  const need = Math.max(pxW / umToInch(spec.widthUm), pxH / umToInch(spec.heightUm));
  return Math.max(PRINT_DPI, Math.ceil(need) + 1);
}

export async function prepareOriginalArtwork(source: DesignSource, spec: StickerSpec): Promise<PrepareOutcome> {
  if (source.kind === 'pdf') return prepareArtwork(source, spec, PRINT_DPI);
  try {
    const direct = await originalBytes(source, spec);
    if (direct) return direct;
  } catch {
    // unreadable header or file: the canvas path below decides (and reports 'corrupt' when it must)
  }
  return prepareArtwork(source, spec, noDownscaleDpi(source.pxWidth, source.pxHeight, spec));
}

/**
 * pdf-lib's JPEG marker walk is stricter than `readJpegInfo` (it does not skip 0xFF fill bytes), and
 * it throws on files the header parser accepted. Try the embed here so such a file falls back to the
 * canvas path instead of failing the whole download later. (An animated PNG is rejected by its
 * `acTL` chunk, so the PNG decode is not paid twice.)
 */
async function pdfLibEmbedsJpeg(bytes: Uint8Array): Promise<boolean> {
  try {
    await (await PDFDocument.create()).embedJpg(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The original file as the artwork, or null when its bytes cannot be embedded as they are. */
async function originalBytes(source: DesignSource, spec: StickerSpec): Promise<PrepareOutcome | null> {
  if (spec.shape === 'custom') {
    // A custom shape is cropped to the alpha box (canvas path), unless that box is the whole PNG.
    if (source.kind !== 'png') return null;
    const t = source.trim;
    if (t && (t.left !== 0 || t.top !== 0)) return null;
  }
  const bytes = new Uint8Array(await source.file.arrayBuffer());

  if (source.kind === 'jpeg') {
    const info = readJpegInfo(bytes);
    if (!info || info.bits !== 8 || (info.sof !== 0xc0 && info.sof !== 0xc1 && info.sof !== 0xc2)) return null;
    if (info.components === 4 ? !info.adobe : info.components !== 1 && info.components !== 3) return null;
    if (info.components === 3 && info.icc === 'other') return null; // pdf-lib drops the profile: the canvas path colour-manages to sRGB
    const turn = exifTurnCw(info.orientation);
    if (turn === null) return null;
    const swap = turn === 90 || turn === 270;
    const orientedW = swap ? info.height : info.width;
    const orientedH = swap ? info.width : info.height;
    if (orientedW !== source.pxWidth || orientedH !== source.pxHeight) return null;
    if (!(await pdfLibEmbedsJpeg(bytes))) return null;
    const dpi = dpiOf(widthPixelsFor(spec.shape, orientedW, orientedH), spec.widthUm);
    return ok(
      {
        kind: 'raster',
        bytes,
        mime: 'image/jpeg',
        pxWidth: info.width,
        pxHeight: info.height,
        hasAlpha: false,
        effectiveDpi: dpi,
        ...(turn ? { rotate: turn } : {}),
      },
      dpi,
    );
  }

  const info = readPngInfo(bytes);
  if (!info || info.hasExif || info.animated || info.icc === 'other') return null;
  if (info.width !== source.pxWidth || info.height !== source.pxHeight || info.width * info.height > MAX_CANVAS_PIXELS) return null;
  if (spec.shape === 'custom' && !source.hasAlpha) return null; // 'no_alpha' comes from the canvas path
  const dpi = dpiOf(widthPixelsFor(spec.shape, info.width, info.height), spec.widthUm);
  return ok({ kind: 'raster', bytes, mime: 'image/png', pxWidth: info.width, pxHeight: info.height, hasAlpha: source.hasAlpha, effectiveDpi: dpi }, dpi);
}
