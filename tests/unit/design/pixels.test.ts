import { describe, expect, it } from 'vitest';
import { alphaBoundingBox, fitWithin, hasAnyAlpha } from '@/lib/design/pixels';

function rgba(w: number, h: number, fill: (x: number, y: number) => number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = fill(x, y);
  return d;
}

describe('alphaBoundingBox', () => {
  it('finds the tight box of an opaque rectangle', () => {
    const d = rgba(20, 10, (x, y) => (x >= 3 && x < 11 && y >= 2 && y < 5 ? 255 : 0));
    expect(alphaBoundingBox(d, 20, 10, 8)).toEqual({ left: 3, top: 2, width: 8, height: 3 });
  });
  it('ignores alpha at or below the threshold', () => {
    const d = rgba(5, 5, (x, y) => (x === 0 && y === 0 ? 8 : x === 2 && y === 3 ? 9 : 0));
    expect(alphaBoundingBox(d, 5, 5, 8)).toEqual({ left: 2, top: 3, width: 1, height: 1 });
  });
  it('returns null when fully transparent', () => {
    expect(alphaBoundingBox(rgba(4, 4, () => 0), 4, 4, 8)).toBeNull();
  });
  it('returns the full box for a fully opaque image', () => {
    expect(alphaBoundingBox(rgba(4, 3, () => 255), 4, 3, 8)).toEqual({ left: 0, top: 0, width: 4, height: 3 });
  });
});

describe('hasAnyAlpha', () => {
  it('false when opaque, true when one pixel is translucent', () => {
    expect(hasAnyAlpha(rgba(3, 3, () => 255), 3, 3)).toBe(false);
    expect(hasAnyAlpha(rgba(3, 3, (x, y) => (x === 1 && y === 1 ? 254 : 255)), 3, 3)).toBe(true);
  });
});

describe('fitWithin', () => {
  it('never upscales', () => expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 }));
  it('scales the long side to the cap, keeping aspect', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });
  it('keeps at least 1px', () => expect(fitWithin(10000, 1, 1600).height).toBe(1));
});
