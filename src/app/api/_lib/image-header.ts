import 'server-only';
/**
 * Byte rules of an upload, shared by POST /api/upload and the direct-upload commit: `rasterHeaderOk`
 * (header check of a PNG/JPEG) and `checkUploadBytes` (magic-byte sniff, the full PNG signature, that header
 * check, a memory-safe decode, and for a PDF the active-content scan; the per-file rules are in ./file-safety).
 */
import sharp from 'sharp';
import { MAX_INPUT_PIXELS, pixelsWithinCap } from '@/lib/design/pixel-cap';
import { sniffKind } from '@/lib/design/kind';
import type { DesignKind } from '@/lib/types';
import { hasPngSignature, pdfHasActiveContent, rasterDecodeOk } from './file-safety';

/**
 * True when the file may be stored. A PDF is never judged here (a real customer PDF must never be
 * rejected by a header rule; the PDF scan is `pdfHasActiveContent` in ./file-safety). A PNG/JPEG must have a header sharp can read (magic bytes alone prove
 * nothing) and at most MAX_INPUT_PIXELS pixels. Reads only the header, so it is cheap.
 */
export async function rasterHeaderOk(bytes: Uint8Array, kind: DesignKind): Promise<boolean> {
  if (kind === 'pdf') return true;
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    return pixelsWithinCap(meta.width, meta.height);
  } catch {
    return false;
  }
}

/** Why `checkUploadBytes` refused a file. */
export type UploadCheckError = 'unsupported_type' | 'corrupt' | 'unsafe';

/**
 * The byte rules shared by POST /api/upload and the direct-upload commit: magic-byte sniff (a PNG needs its
 * full 8-byte signature), then the header check, then a bounded decode of a raster; a PDF that pdf-lib can
 * read is scanned for scripts, embedded files and other active content ('unsafe').
 */
export async function checkUploadBytes(
  bytes: Uint8Array,
): Promise<{ ok: true; kind: DesignKind } | { ok: false; error: UploadCheckError }> {
  const kind = sniffKind(bytes);
  if (!kind) return { ok: false, error: 'unsupported_type' };
  if (kind === 'png' && !hasPngSignature(bytes)) return { ok: false, error: 'unsupported_type' };
  if (!(await rasterHeaderOk(bytes, kind))) return { ok: false, error: 'corrupt' };
  if (!(await rasterDecodeOk(bytes, kind))) return { ok: false, error: 'corrupt' };
  if (kind === 'pdf' && (await pdfHasActiveContent(bytes))) return { ok: false, error: 'unsafe' };
  return { ok: true, kind };
}
