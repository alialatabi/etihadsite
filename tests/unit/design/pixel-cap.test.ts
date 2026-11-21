import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { MAX_INPUT_PIXELS, pixelsOverCap, pixelsWithinCap } from '@/lib/design/pixel-cap';
import type { StickerSpec } from '@/lib/types';
import { pngWithDeclaredSize } from '../png-header';

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, '..', '..', 'fixtures', n)));
const spec: StickerSpec = { shape: 'rect', corners: 'sharp', widthUm: 40_000, heightUm: 60_000 };

describe('pixel cap logic', () => {
  it('lets a full A4 at 1200 DPI (9921 x 14031, about 139.2 MP) through, in either orientation', () => {
    expect(9921 * 14031).toBeLessThan(MAX_INPUT_PIXELS);
    expect(pixelsOverCap(9921, 14031)).toBe(false);
    expect(pixelsOverCap(14031, 9921)).toBe(false);
    expect(pixelsWithinCap(9921, 14031)).toBe(true);
  });

  it('refuses a header over the cap, and accepts exactly the cap', () => {
    expect(pixelsOverCap(16_000, 16_000)).toBe(true);
    expect(pixelsWithinCap(16_000, 16_000)).toBe(false);
    expect(pixelsWithinCap(15_000, 10_000)).toBe(true); // exactly 150 MP
    expect(pixelsOverCap(15_000, 10_001)).toBe(true);
  });

  it('missing dimensions: not "over" (the decoder decides) but not "within" either (the commit check refuses)', () => {
    expect(pixelsOverCap(undefined, undefined)).toBe(false);
    expect(pixelsWithinCap(undefined, 10)).toBe(false);
    expect(pixelsWithinCap(0, 10)).toBe(false);
  });
});

describe('normaliseArtwork pixel cap (VB-7)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses an over-limit header as corrupt before any decode, without logging a failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 15000 x 15000 = 225 MP: under sharp's own default (about 268 MP), over our cap.
    const r = await normaliseArtwork(pngWithDeclaredSize(15_000, 15_000), { spec, targetDpi: 300, blockDpi: 72 });
    expect(r).toEqual({ ok: false, error: 'corrupt' });
    expect(err).not.toHaveBeenCalled(); // the explicit check returns before the decode (a throw would be logged and reported)
  });

  it('also refuses, without logging, a header over the sharp default limit (20000 x 20000 = 400 MP)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await normaliseArtwork(pngWithDeclaredSize(20_000, 20_000), { spec, targetDpi: 300, blockDpi: 72 });
    expect(r).toEqual({ ok: false, error: 'corrupt' });
    expect(err).not.toHaveBeenCalled();
  });

  it('still normalises an ordinary image', async () => {
    const r = await normaliseArtwork(fx('exif6-600x400.jpg'), { spec, targetDpi: 300, blockDpi: 72 });
    expect(r.ok).toBe(true);
  });
});
