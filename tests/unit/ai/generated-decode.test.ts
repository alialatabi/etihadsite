/**
 * A custom-shape PNG from normaliseGenerated must pass the site's own decode rules: the browser
 * (decode.client.ts → scanAlphaStrips → hasAnyAlpha / alphaBoundingBox at ALPHA_THRESHOLD) and the
 * order route (normaliseArtwork). Both use the same pure helpers, so they are checked here on the
 * raw pixels sharp decodes, plus the real server path.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normaliseGenerated } from '@/lib/ai/normalise';
import { customArtworkUsable } from '@/lib/ai/service';
import { normaliseArtwork } from '@/lib/design/normalise.server';
import { ALPHA_THRESHOLD, alphaBoundingBox, hasAnyAlpha } from '@/lib/design/pixels';
import { modelCustomPng, opaqueRgbaPng } from '../server/ai-helpers';

async function rgba(png: Uint8Array) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

describe('custom AI PNG against the site decode', () => {
  it('normalised model output has alpha and trims to the subject (never no_alpha)', async () => {
    const subject = { left: 20, top: 16, width: 24, height: 30 };
    const out = await normaliseGenerated(await modelCustomPng(64, 64, subject), 'custom');
    const { data, width, height } = await rgba(out.png);
    expect(hasAnyAlpha(data, width, height)).toBe(true);
    expect(alphaBoundingBox(data, width, height, ALPHA_THRESHOLD)).toEqual(subject);
    expect(await customArtworkUsable(out.png)).toBe(true);

    const order = await normaliseArtwork(out.png, {
      spec: { shape: 'custom', widthUm: 60000, heightUm: 60000 },
      targetDpi: 300,
      blockDpi: 1,
    });
    expect(order.ok).toBe(true);
    if (order.ok) {
      expect(order.artwork.kind).toBe('raster');
      if (order.artwork.kind === 'raster') expect(order.artwork.hasAlpha).toBe(true);
    }
  });

  it('a model output opaque edge to edge loses all alpha in normalisation: the route guard catches it', async () => {
    const out = await normaliseGenerated(await opaqueRgbaPng(), 'custom');
    const { data, width, height } = await rgba(out.png);
    expect(hasAnyAlpha(data, width, height)).toBe(false); // the browser would answer no_alpha
    expect(await customArtworkUsable(out.png)).toBe(false);
  });

  it('a fully transparent output is not usable either (the browser would answer empty)', async () => {
    const clear = new Uint8Array(
      await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(),
    );
    const out = await normaliseGenerated(clear, 'custom');
    expect(await customArtworkUsable(out.png)).toBe(false);
  });
});
