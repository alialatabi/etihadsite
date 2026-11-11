import { describe, expect, it } from 'vitest';
import { ALPHA_THRESHOLD, alphaBoundingBox, fitWithin, hasAnyAlpha, scanAlphaStrips, type PixelRect } from '@/lib/design/pixels';

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

describe('scanAlphaStrips', () => {
  type Rgba = Uint8Array | Uint8ClampedArray;

  /** Serves strips out of a whole-image buffer and records every read as [y0, rows]. */
  function stripReader(whole: Rgba, w: number) {
    const reads: [number, number][] = [];
    const readStrip = (y0: number, rows: number) => {
      reads.push([y0, rows]);
      return whole.subarray(y0 * w * 4, (y0 + rows) * w * 4);
    };
    return { readStrip, reads };
  }

  /** The strip loop of decodeRaster as it was before scanAlphaStrips() existed (canvas reads replaced by readStrip). */
  function scanBefore(W: number, H: number, STRIP_ROWS: number, readStrip: (y0: number, rows: number) => Rgba) {
    let hasAlpha = false;
    let box: PixelRect | null = { left: 0, top: 0, width: W, height: H };
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y0 = 0; y0 < H; y0 += STRIP_ROWS) {
      const rows = Math.min(STRIP_ROWS, H - y0);
      const data = readStrip(y0, rows);
      if (!hasAlpha && hasAnyAlpha(data, W, rows)) hasAlpha = true;
      const b = alphaBoundingBox(data, W, rows, ALPHA_THRESHOLD);
      if (b) {
        minX = Math.min(minX, b.left);
        maxX = Math.max(maxX, b.left + b.width - 1);
        minY = Math.min(minY, y0 + b.top);
        maxY = Math.max(maxY, y0 + b.top + b.height - 1);
      }
    }
    box = maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    return { hasAlpha, box };
  }

  const W = 12;
  const H = 10;
  const FULL = { left: 0, top: 0, width: W, height: H };
  const IMAGES: { name: string; data: Uint8ClampedArray; hasAlpha: boolean; box: PixelRect | null }[] = [
    { name: 'opaque', data: rgba(W, H, () => 255), hasAlpha: false, box: FULL },
    { name: 'fully transparent', data: rgba(W, H, () => 0), hasAlpha: true, box: null },
    { name: 'faint everywhere (alpha at the threshold)', data: rgba(W, H, () => ALPHA_THRESHOLD), hasAlpha: true, box: null },
    { name: 'alpha only in the last row', data: rgba(W, H, (_x, y) => (y === H - 1 ? 0 : 255)), hasAlpha: true, box: { left: 0, top: 0, width: W, height: H - 1 } },
    { name: 'one translucent pixel in the last row', data: rgba(W, H, (x, y) => (x === 5 && y === H - 1 ? 200 : 255)), hasAlpha: true, box: FULL },
    { name: 'alpha only in the first row', data: rgba(W, H, (_x, y) => (y === 0 ? 0 : 255)), hasAlpha: true, box: { left: 0, top: 1, width: W, height: H - 1 } },
    {
      name: 'padded artwork with a soft edge',
      data: rgba(W, H, (x, y) => (x >= 3 && x < 9 && y >= 2 && y < 8 ? 255 : x === 2 && y === 5 ? ALPHA_THRESHOLD + 1 : x === 9 && y === 5 ? ALPHA_THRESHOLD : 0)),
      hasAlpha: true,
      box: { left: 2, top: 2, width: 7, height: 6 },
    },
    {
      name: 'two separate blobs in different strips',
      data: rgba(W, H, (x, y) => ((x === 1 && y === 1) || (x === 10 && y === 8) ? 255 : 0)),
      hasAlpha: true,
      box: { left: 1, top: 1, width: 10, height: 8 },
    },
  ];
  /** Strip heights that divide the image height (1, 2, 5, 10), that do not (3, 4, 7), and a taller one. */
  const STRIP_HEIGHTS = [1, 2, 3, 4, 5, 7, 10, 256];
  const CASES = IMAGES.flatMap((image) => STRIP_HEIGHTS.map((stripRows) => ({ ...image, stripRows })));

  it.each(CASES)('$name, strips of $stripRows: needBox gives the whole-image hasAnyAlpha and alphaBoundingBox', ({ data, hasAlpha, box, stripRows }) => {
    const { readStrip, reads } = stripReader(data, W);
    const scan = scanAlphaStrips(W, H, stripRows, readStrip, true);
    expect(scan).toEqual({ hasAlpha, box });
    expect(scan).toEqual({ hasAlpha: hasAnyAlpha(data, W, H), box: alphaBoundingBox(data, W, H, ALPHA_THRESHOLD) });
    expect(scan).toEqual(scanBefore(W, H, stripRows, stripReader(data, W).readStrip));
    // Every row is read exactly once, top to bottom, never more than stripRows at a time.
    expect(reads).toHaveLength(Math.ceil(H / stripRows));
    let next = 0;
    for (const [y0, rows] of reads) {
      expect(y0).toBe(next);
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(stripRows);
      next = y0 + rows;
    }
    expect(next).toBe(H);
  });

  it.each(CASES)('$name, strips of $stripRows: without needBox it stops at the first strip with alpha and returns the full box', ({ data, hasAlpha, stripRows }) => {
    const { readStrip, reads } = stripReader(data, W);
    expect(scanAlphaStrips(W, H, stripRows, readStrip, false)).toEqual({ hasAlpha, box: FULL });
    const strips = Math.ceil(H / stripRows);
    let firstWithAlpha = -1;
    for (let i = 0; i < strips && firstWithAlpha < 0; i++) {
      const rows = Math.min(stripRows, H - i * stripRows);
      if (hasAnyAlpha(data.subarray(i * stripRows * W * 4, (i * stripRows + rows) * W * 4), W, rows)) firstWithAlpha = i;
    }
    expect(firstWithAlpha >= 0).toBe(hasAlpha);
    expect(reads).toHaveLength(hasAlpha ? firstWithAlpha + 1 : strips);
    expect(reads.map(([y0]) => y0)).toEqual(Array.from({ length: reads.length }, (_, i) => i * stripRows));
  });

  it('early exit, counted: alpha in the first of five strips is one read; in the last strip, or none, is five', () => {
    const count = (data: Uint8ClampedArray, needBox: boolean) => {
      const { readStrip, reads } = stripReader(data, W);
      scanAlphaStrips(W, H, 2, readStrip, needBox);
      return reads.length;
    };
    const first = rgba(W, H, (x, y) => (x === 0 && y === 0 ? 0 : 255));
    const last = rgba(W, H, (x, y) => (x === W - 1 && y === H - 1 ? 0 : 255));
    const opaque = rgba(W, H, () => 255);
    expect([count(first, false), count(last, false), count(opaque, false)]).toEqual([1, 5, 5]);
    expect([count(first, true), count(last, true), count(opaque, true)]).toEqual([5, 5, 5]);
  });

  it('accepts a plain Uint8Array as well as a Uint8ClampedArray', () => {
    const data = new Uint8Array(rgba(W, H, (x, y) => (x >= 3 && x < 9 && y >= 2 && y < 8 ? 255 : 0)));
    expect(scanAlphaStrips(W, H, 3, stripReader(data, W).readStrip, true)).toEqual({ hasAlpha: true, box: { left: 3, top: 2, width: 6, height: 6 } });
  });
});
