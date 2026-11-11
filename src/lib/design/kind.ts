/**
 * Design file kinds: detection by magic bytes, plus the MIME type and the file extension of
 * each kind. Pure (no Node or browser APIs), so routes can use it without loading sharp.
 */
import type { DesignKind } from '@/lib/types';

/** Sniff PNG / JPEG / PDF by magic bytes; null when unknown. Also used by /api/upload. */
export function sniffKind(bytes: Uint8Array): DesignKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'pdf';
  return null;
}

export const MIME_BY_KIND = { png: 'image/png', jpeg: 'image/jpeg', pdf: 'application/pdf' } as const satisfies Record<DesignKind, string>;

export const EXT_BY_KIND = { png: 'png', jpeg: 'jpg', pdf: 'pdf' } as const satisfies Record<DesignKind, string>;
