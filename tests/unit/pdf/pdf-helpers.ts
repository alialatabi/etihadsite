/** Shared helpers for the PDF unit tests (not a test file: vitest only collects *.test.ts). */
import sharp from 'sharp';
import { PDFArray, PDFRawStream, decodePDFRawStream, type PDFPage } from 'pdf-lib';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { computeLayout, layoutParamsFor } from '@/lib/layout';
import type { LayoutResult, LayoutSettings, NormalisedArtwork, StickerSpec } from '@/lib/types';
import cases from '@/lib/__fixtures__/layout-cases.json';

export const SETTINGS: LayoutSettings = { ...DEFAULT_SETTINGS.layout, marginUm: 3_000 };

export function layoutFor(spec: StickerSpec, settings: LayoutSettings = SETTINGS): LayoutResult {
  const out = computeLayout(spec, layoutParamsFor(spec, settings));
  if (!out.ok) throw new Error(`layout failed: ${out.reason}`);
  return out.layout;
}

type Case = { name: string; spec: StickerSpec; expected: { ok: boolean; layout?: LayoutResult } };
export const fixtureLayout = (prefix: string): LayoutResult => {
  const c = (cases as Case[]).find((x) => x.name.startsWith(prefix));
  if (!c?.expected.layout) throw new Error('missing fixture ' + prefix);
  return c.expected.layout;
};

export async function raster(w: number, h: number, alpha = false): Promise<NormalisedArtwork> {
  const img = sharp({ create: { width: w, height: h, channels: 4, background: { r: 30, g: 120, b: 220, alpha: 1 } } });
  const bytes = alpha ? await img.png().toBuffer() : await img.flatten().jpeg({ quality: 90 }).toBuffer();
  return { kind: 'raster', bytes: new Uint8Array(bytes), mime: alpha ? 'image/png' : 'image/jpeg', pxWidth: w, pxHeight: h, hasAlpha: alpha, effectiveDpi: 300 };
}

export function contentOf(page: PDFPage): string {
  const ctx = page.doc.context;
  const contents = page.node.Contents();
  if (!contents) return '';
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
  return streams
    .map((s) => {
      if (!(s instanceof PDFRawStream)) throw new Error('unexpected stream type');
      return Buffer.from(decodePDFRawStream(s).decode()).toString('latin1');
    })
    .join('\n');
}
