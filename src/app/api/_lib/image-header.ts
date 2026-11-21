import 'server-only';
/**
 * Byte rules of an upload, shared by POST /api/upload and the direct-upload commit: `rasterHeaderOk`
 * (header check of a PNG/JPEG) and `checkUploadBytes` (magic-byte sniff, then that header check).
 */
import sharp from 'sharp';
import { MAX_INPUT_PIXELS, pixelsWithinCap } from '@/lib/design/pixel-cap';
import { sniffKind } from '@/lib/design/kind';
import type { DesignKind } from '@/lib/types';

/**
 * True when the file may be stored. A PDF is never judged here (a real customer PDF must never be
 * rejected by a new rule). A PNG/JPEG must have a header sharp can read (magic bytes alone prove
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

/** Magic-byte sniff, then the header check: the byte rules shared by POST /api/upload and the direct-upload commit. */
export async function checkUploadBytes(
  bytes: Uint8Array,
): Promise<{ ok: true; kind: DesignKind } | { ok: false; error: 'unsupported_type' | 'corrupt' }> {
  const kind = sniffKind(bytes);
  if (!kind) return { ok: false, error: 'unsupported_type' };
  if (!(await rasterHeaderOk(bytes, kind))) return { ok: false, error: 'corrupt' };
  return { ok: true, kind };
}
