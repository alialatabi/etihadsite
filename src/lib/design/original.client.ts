'use client';
/**
 * STUB (replaced by Part A of docs/superpowers/specs/2026-11-26-staff-original-art-and-receipts.md):
 * the staff page's artwork at the uploaded file's own resolution and colours.
 */
import { PRINT_DPI } from '@/lib/print-dpi';
import type { DesignSource, StickerSpec } from '@/lib/types';
import { prepareArtwork, type PrepareOutcome } from './prepare.client';

export async function prepareOriginalArtwork(source: DesignSource, spec: StickerSpec): Promise<PrepareOutcome> {
  return prepareArtwork(source, spec, PRINT_DPI);
}
