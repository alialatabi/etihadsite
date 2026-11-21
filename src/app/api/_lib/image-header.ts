import 'server-only';
/** Header check of a stored raster upload: used by both upload routes after the magic-byte sniff. */
import sharp from 'sharp';
import { MAX_INPUT_PIXELS, pixelsWithinCap } from '@/lib/design/pixel-cap';
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
