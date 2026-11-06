import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normaliseArtwork, sniffKind } from '@/lib/design/normalise.server';
import type { StickerSpec } from '@/lib/types';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const rect = (wMm: number, hMm: number): StickerSpec => ({
  shape: 'rect',
  corners: 'sharp',
  widthUm: wMm * 1000,
  heightUm: hMm * 1000,
});
const opts = (spec: StickerSpec, blockDpi = 72) => ({ spec, targetDpi: 300, blockDpi });

describe('sniffKind', () => {
  it('detects by magic bytes', () => {
    expect(sniffKind(fx('exif6-600x400.jpg'))).toBe('jpeg');
    expect(sniffKind(fx('padded-400x400.png'))).toBe('png');
    expect(sniffKind(fx('two-page.pdf'))).toBe('pdf');
    expect(sniffKind(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(sniffKind(new Uint8Array(0))).toBeNull();
  });
});

describe('normaliseArtwork raster', () => {
  it('applies EXIF orientation 6: 600x400 -> 400x600 portrait', async () => {
    const r = await normaliseArtwork(fx('exif6-600x400.jpg'), opts(rect(40, 60)));
    expect(r.ok).toBe(true);
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('x');
    expect([r.pxWidth, r.pxHeight]).toEqual([400, 600]);
    expect(r.kind).toBe('jpeg');
    expect(r.artwork.mime).toBe('image/jpeg');
    const m = await sharp(r.artwork.bytes).metadata();
    expect([m.width, m.height]).toEqual([400, 600]);
    expect(m.orientation ?? 1).toBe(1);
  });

  it('computes effectiveDpi from original px over spec width and never upscales', async () => {
    const r = await normaliseArtwork(fx('exif6-600x400.jpg'), opts(rect(40, 60)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('x');
    expect(r.artwork.effectiveDpi).toBeCloseTo(400 / (40 / 25.4), 5);
    expect(r.artwork.pxWidth).toBe(400); // 40mm@300dpi = 472 px > 400: not upscaled
  });

  it('downsamples when the original is larger than target', async () => {
    const r = await normaliseArtwork(fx('exif6-600x400.jpg'), opts(rect(20, 30)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('x');
    expect(r.artwork.pxWidth).toBe(236); // 20mm @ 300 dpi
    expect(r.artwork.pxHeight).toBe(354);
  });

  it('custom shape trims the padded PNG to 200x100 and uses 200 px for DPI', async () => {
    const spec: StickerSpec = { shape: 'custom', widthUm: 50_000, heightUm: 25_000 };
    const r = await normaliseArtwork(fx('padded-400x400.png'), opts(spec));
    expect(r.ok).toBe(true);
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('x');
    expect([r.pxWidth, r.pxHeight]).toEqual([200, 100]);
    expect(r.artwork.hasAlpha).toBe(true);
    expect(r.artwork.mime).toBe('image/png');
    expect(r.artwork.effectiveDpi).toBeCloseTo(200 / (50 / 25.4), 5);
    const m = await sharp(r.artwork.bytes).metadata();
    expect([m.width, m.height]).toEqual([200, 100]);
  });

  it('custom shape rejects an opaque JPEG with no_alpha', async () => {
    const spec: StickerSpec = { shape: 'custom', widthUm: 50_000, heightUm: 50_000 };
    expect(await normaliseArtwork(fx('opaque-300x300.jpg'), opts(spec))).toEqual({ ok: false, error: 'no_alpha' });
  });

  it('non-custom PNG with alpha stays PNG with its alpha', async () => {
    const r = await normaliseArtwork(fx('padded-400x400.png'), opts(rect(50, 50)));
    if (!r.ok || r.artwork.kind !== 'raster') throw new Error('x');
    expect(r.artwork.mime).toBe('image/png');
    expect([r.pxWidth, r.pxHeight]).toEqual([400, 400]);
  });

  it('blocks low DPI (300 px over 200 mm = 38 dpi < 72)', async () => {
    const r = await normaliseArtwork(fx('opaque-300x300.jpg'), opts(rect(200, 200), 72));
    expect(r).toEqual({ ok: false, error: 'low_dpi' });
    const ok = await normaliseArtwork(fx('opaque-300x300.jpg'), opts(rect(100, 100), 72)); // 76 dpi
    expect(ok.ok).toBe(true);
  });

  it('unknown and corrupt input', async () => {
    expect(await normaliseArtwork(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]), opts(rect(10, 10)))).toEqual({
      ok: false,
      error: 'unsupported_type',
    });
    const bad = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
    expect(await normaliseArtwork(bad, opts(rect(10, 10)))).toEqual({ ok: false, error: 'corrupt' });
  });
});

describe('normaliseArtwork pdf', () => {
  it('takes box from CropBox and rotate from /Rotate; px follow the rotated viewer', async () => {
    const r = await normaliseArtwork(fx('cropbox-rot90.pdf'), opts(rect(30, 40)));
    expect(r.ok).toBe(true);
    if (!r.ok || r.artwork.kind !== 'pdf') throw new Error('x');
    expect(r.artwork.box).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    expect(r.artwork.rotate).toBe(90);
    expect(r.artwork.pageCount).toBe(1);
    expect([r.pxWidth, r.pxHeight]).toEqual([300, 400]);
    expect(r.kind).toBe('pdf');
  });

  it('reports the page count of a 2-page PDF', async () => {
    const r = await normaliseArtwork(fx('two-page.pdf'), opts(rect(40, 20)));
    if (!r.ok || r.artwork.kind !== 'pdf') throw new Error('x');
    expect(r.artwork.pageCount).toBe(2);
    expect(r.artwork.box).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(r.artwork.rotate).toBe(0);
  });

  it('flags encrypted PDFs', async () => {
    expect(await normaliseArtwork(fx('encrypted-marker.pdf'), opts(rect(10, 10)))).toEqual({ ok: false, error: 'encrypted' });
  });

  it('answers needs_raster for an unparseable non-encrypted PDF', async () => {
    const junk = new TextEncoder().encode('%PDF-1.4\nthis is not a pdf at all\n%%EOF');
    expect(await normaliseArtwork(junk, opts(rect(10, 10)))).toEqual({ ok: false, error: 'needs_raster' });
  });
});
