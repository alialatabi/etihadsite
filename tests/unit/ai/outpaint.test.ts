import { randomFillSync } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AI_EXTEND_TIMEOUT_MS,
  AI_MIN_EXTEND_BUDGET_MS,
  AI_OUTPAINT_CANVAS_LONG as W,
  AI_OUTPAINT_CANVAS_SHORT as H,
  AI_OUTPAINT_FEATHER_PX,
  AI_OUTPAINT_KEEP_PX,
} from '@/lib/ai/config';
import { fitLongPng, outpaintToAspect, type ExtendCall } from '@/lib/ai/outpaint';

const GREEN = [60, 170, 90] as const;
const RED = [220, 40, 40] as const;
const BLUE = [40, 40, 220] as const;

async function solid(w: number, h: number, c: readonly number[] = GREEN): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toBuffer());
}

interface Seen {
  size: string;
  prompt: string;
  timeoutMs: number;
  /** Where the visible strip of the canvas lies: start = left / top. */
  stripAt: 'start' | 'end';
  /** Opaque pixels along the long axis of the first row / column. */
  opaqueLong: number;
  portrait: boolean;
}

/**
 * A model that keeps the visible strip and paints the empty part RED (when the empty part is at the end: right /
 * bottom) or BLUE (at the start), so the finished picture shows which end each step went to.
 */
function fakeModel(seen: Seen[] = [], tintVisible?: readonly number[]): ExtendCall {
  return async ({ size, prompt, canvas, timeoutMs }) => {
    const { data, info } = await sharp(canvas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const portrait = info.height > info.width;
    const long = portrait ? info.height : info.width;
    const alphaAt = (i: number) => data[(portrait ? i * info.width : i) * 4 + 3];
    let opaqueLong = 0;
    for (let i = 0; i < long; i++) if (alphaAt(i) === 255) opaqueLong++;
    const stripAt = alphaAt(0) === 255 ? 'start' : 'end';
    seen.push({ size, prompt, timeoutMs, stripAt, opaqueLong, portrait });
    const empty = stripAt === 'start' ? RED : BLUE;
    const out = Buffer.alloc(info.width * info.height * 3);
    for (let i = 0; i < info.width * info.height; i++) {
      const visible = data[i * 4 + 3] === 255;
      const src = visible ? (tintVisible ?? [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]) : empty;
      out.set(src, i * 3);
    }
    const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    return { ok: true, png: new Uint8Array(png) };
  };
}

const plenty = () => 200_000;

async function pixels(png: Uint8Array) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    info,
    px: (x: number, y: number) => [data[(y * info.width + x) * 3], data[(y * info.width + x) * 3 + 1], data[(y * info.width + x) * 3 + 2]],
  };
}

describe('outpaintToAspect', () => {
  it('7:1 landscape: 3360 x 480, one call per end, start end blue and end end red, the middle untouched', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 7, extend: fakeModel(seen), timeLeftMs: plenty });
    expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
    expect(out).toMatchObject({ path: 'ai', calls: 2, stepsOk: 2, reasons: [] });
    expect(seen).toHaveLength(2);
    for (const s of seen) {
      expect(s.size).toBe(`${W}x${H}`);
      expect(s.opaqueLong).toBe(AI_OUTPAINT_KEEP_PX);
      expect(s.timeoutMs).toBeLessThanOrEqual(AI_EXTEND_TIMEOUT_MS);
    }
    // The end that extends the start has its visible strip at the end of the canvas.
    expect(seen.map((s) => s.stripAt).sort()).toEqual(['end', 'start']);
    const p = await pixels(out.png);
    expect(p.info.channels).toBe(3);
    expect(p.px(0, 100)).toEqual([...BLUE]);
    expect(p.px(3359, 100)).toEqual([...RED]);
    expect(p.px(968 + 700, 240)).toEqual([...GREEN]);
    expect(p.px(100, 0)).toEqual([...BLUE]);
    expect((await sharp(out.png).metadata()).hasAlpha).toBe(false);
  });

  it('feathers the seam: the pixels across the overlap go linearly from the new picture to the old one', async () => {
    // A model that repaints the visible strip grey (it should not, but it may drift): the overlap hides the difference.
    const grey = [200, 200, 200] as const;
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 7, extend: fakeModel([], grey), timeLeftMs: plenty });
    const p = await pixels(out.png);
    // Start end: new part [0, 968) is the model's, the F px of overlap [968, 968 + F) ramp from the model's grey to the old green.
    const seam = Array.from({ length: AI_OUTPAINT_FEATHER_PX }, (_, i) => p.px(968 + i, 10)[0]);
    expect(p.px(967, 10)[0]).toBe(BLUE[0]);
    for (let i = 1; i < seam.length; i++) expect(seam[i]).toBeLessThanOrEqual(seam[i - 1]);
    expect(seam[0]).toBeGreaterThan(seam[seam.length - 1] + 100);
    expect(p.px(968 + AI_OUTPAINT_FEATHER_PX, 10)[0]).toBe(GREEN[0]);
    // The end end ramps the same way: old green into the model's grey over its last F px, then the new red.
    const tail = Array.from({ length: AI_OUTPAINT_FEATHER_PX }, (_, i) => p.px(3360 - 968 - AI_OUTPAINT_FEATHER_PX + i, 10)[0]);
    for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeGreaterThanOrEqual(tail[i - 1]);
    expect(p.px(3360 - 968, 10)[0]).toBe(RED[0]);
  });

  it('portrait 1:7: 480 x 3360, the canvas goes to the model in portrait, top is the start end', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(H, W), { portrait: true, aspect: 7, extend: fakeModel(seen), timeLeftMs: plenty });
    expect([out.pxWidth, out.pxHeight]).toEqual([480, 3360]);
    expect(out.path).toBe('ai');
    for (const s of seen) {
      expect(s.size).toBe(`${H}x${W}`);
      expect(s.portrait).toBe(true);
      expect(s.prompt).toContain('vertical');
      expect(s.prompt).not.toContain('horizontal');
    }
    const p = await pixels(out.png);
    expect(p.px(100, 0)).toEqual([...BLUE]); // top
    expect(p.px(100, 3359)).toEqual([...RED]); // bottom
    expect(p.px(100, 1500)).toEqual([...GREEN]);
  });

  it('the orientation comes from the sticker, not from the returned picture', async () => {
    // A landscape sticker whose base picture came back portrait is stretched to the canvas, never rotated.
    const out = await outpaintToAspect(await solid(100, 300), { portrait: false, aspect: 7, extend: fakeModel(), timeLeftMs: plenty });
    expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
  });

  it('14:1: the last call of each end takes only the pixels still needed (3 calls each), exactly 6720 px', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 14, extend: fakeModel(seen), timeLeftMs: plenty });
    expect([out.pxWidth, out.pxHeight]).toEqual([6720, 480]);
    expect(out).toMatchObject({ path: 'ai', calls: 6, stepsOk: 6 });
    expect(seen).toHaveLength(6);
  });

  it('14:1 chains: step 2 is cut from the grown picture, the last step takes the right pixels, the order is right from the outside in', async () => {
    // The model paints the empty part with a ramp in the red channel: 0 at the outer edge of the canvas up to 200 next to the
    // visible strip, so a wrong source for a canvas or a wrong slice of the model's picture shows in the pixels.
    const ramp = (d: number) => Math.round((d / (W - AI_OUTPAINT_KEEP_PX - 1)) * 200);
    const canvases: { at: 'start' | 'end'; png: Uint8Array }[] = [];
    const model: ExtendCall = async ({ canvas }) => {
      const { data } = await sharp(canvas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const at = data[3] === 255 ? 'start' : 'end';
      canvases.push({ at, png: canvas });
      const out = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (data[i * 4 + 3] === 255) out.set([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]], i * 3);
          else out.set([ramp(at === 'start' ? W - 1 - x : x), 100, 100], i * 3);
        }
      }
      return { ok: true, png: new Uint8Array(await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()) };
    };
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 14, extend: model, timeLeftMs: plenty });
    expect([out.pxWidth, out.pxHeight]).toEqual([6720, 480]);
    expect(out.path).toBe('ai');

    // Step 2 of the left end (the painting-left calls have their strip at the END of the canvas): its visible strip is the
    // outer KEEP px of the picture after step 1, i.e. the ramp from the outer edge, not the original green strip.
    const leftCalls = canvases.filter((c) => c.at === 'end');
    expect(leftCalls).toHaveLength(3);
    const step2 = await pixels(leftCalls[1].png);
    expect(step2.px(W - AI_OUTPAINT_KEEP_PX, 10)[0]).toBe(ramp(0));
    expect(step2.px(W - 1, 10)[0]).toBe(ramp(AI_OUTPAINT_KEEP_PX - 1));
    expect(step2.px(W - AI_OUTPAINT_KEEP_PX, 10)).not.toEqual([...GREEN]);

    // Final picture, left end: [0,712) is the LAST step (the 712 px of its painting nearest the strip: distance 256..967),
    // [712,1680) the second step, [1680,2648) the first, then the original picture. The right end mirrors it.
    const p = await pixels(out.png);
    const last = (i: number) => ramp(256 + i);
    const full = (i: number) => ramp(i);
    expect(p.px(0, 10)[0]).toBe(last(0));
    expect(p.px(711, 10)[0]).toBe(last(711));
    expect(p.px(712, 10)[0]).toBe(full(0));
    expect(p.px(1679, 10)[0]).toBe(full(967));
    expect(p.px(1680, 10)[0]).toBe(full(0));
    expect(p.px(2647, 10)[0]).toBe(full(967));
    expect(p.px(2648 + 600, 10)).toEqual([...GREEN]);
    for (let i = 0; i < 4; i++) {
      const j = [0, 711, 712, 1679][i];
      expect(p.px(6719 - j, 10)[0]).toBe([last(0), last(711), full(0), full(967)][i]);
    }
  });

  it('sends the prompt of the empty side, the left end of a banner for an extension to the right', async () => {
    const seen: Seen[] = [];
    await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 7, extend: fakeModel(seen), timeLeftMs: plenty });
    const right = seen.find((s) => s.stripAt === 'start')!; // visible strip at the left: painting to the right
    expect(right.prompt).toContain('This is the left end of a long horizontal sticker banner.');
    expect(right.prompt).toContain('The transparent area on the right is empty and must be painted.');
    expect(right.prompt).toContain('Do not add any text, letters or numbers.');
    const left = seen.find((s) => s.stripAt === 'end')!;
    expect(left.prompt).toContain('This is the right end of a long horizontal sticker banner.');
    expect(left.prompt).toContain('The transparent area on the left is empty');
  });

  describe('failure policy: blur-fill, never stripes', () => {
    const base = async () => {
      // A black column at both outer edges (an edge-pixel copy would repeat it as a black stripe) and one well inside.
      const raw = Buffer.alloc(W * H * 3, 255);
      for (let y = 0; y < H; y++) for (const x of [0, 300, W - 301, W - 1]) raw.set([0, 0, 0], (y * W + x) * 3);
      return new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    };

    for (const reason of ['refused', 'timeout', 'error'] as const) {
      it(`${reason} on every step: still the exact size, blurred ends, the sharp picture in place`, async () => {
        const out = await outpaintToAspect(await base(), {
          portrait: false,
          aspect: 7,
          extend: async () => ({ ok: false, reason }),
          timeLeftMs: plenty,
        });
        expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
        expect(out).toMatchObject({ path: 'blur', calls: 2, stepsOk: 0, reasons: [reason] });
        const p = await pixels(out.png);
        // The sharp picture sits where it belongs (offset 968): its inner black column is intact...
        expect(p.px(968 + 300, 200)).toEqual([0, 0, 0]);
        expect(p.px(968 + W - 301, 200)).toEqual([0, 0, 0]);
        // ...and the new ends are a soft blur of it, not a copy of the black edge pixel.
        expect(p.px(0, 200)[0]).toBeGreaterThan(200);
        expect(p.px(3359, 200)[0]).toBeGreaterThan(200);
        expect(p.px(500, 200)[0]).toBeGreaterThan(200);
      });
    }

    it('the blurred ends scale the picture evenly (no smeared bands): an object near the edge stays as tall as it is wide', async () => {
      // A dark 100 x 100 square on white, left of the middle. The blur ends show it enlarged by the same factor on both axes.
      const raw = Buffer.alloc(W * H * 3, 255);
      for (let y = 190; y < 290; y++) for (let x = 150; x < 250; x++) raw.set([0, 0, 0], (y * W + x) * 3);
      const base = new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
      const out = await outpaintToAspect(base, { portrait: false, aspect: 7, extend: async () => ({ ok: false, reason: 'error' }), timeLeftMs: plenty });
      const { data, info } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
      const v = (x: number, y: number) => data[(y * info.width + x) * 3];
      // Left blur zone is [0, 968 - F). Find the darkest pixel, then the extent of the dark blob along its row and column.
      let best = 255;
      let bx = 0;
      let by = 0;
      for (let y = 0; y < H; y += 4) for (let x = 0; x < 968 - AI_OUTPAINT_FEATHER_PX; x += 4) if (v(x, y) < best) [best, bx, by] = [v(x, y), x, y];
      expect(best).toBeLessThan(200); // the square is there, enlarged and soft
      const thr = (255 + best) / 2;
      let w = 0;
      for (let x = 0; x < 968 - AI_OUTPAINT_FEATHER_PX; x++) if (v(x, by) < thr) w++;
      let h = 0;
      for (let y = 0; y < H; y++) if (v(bx, y) < thr) h++;
      expect(w / h).toBeGreaterThan(0.6);
      expect(w / h).toBeLessThan(1.7);
      // A heavy blur: no hard edge anywhere in the blur zone (a stretched or copied picture would keep the square's edges).
      let maxStep = 0;
      for (let y = 0; y < H; y += 8) for (let x = 1; x < 968 - AI_OUTPAINT_FEATHER_PX; x++) maxStep = Math.max(maxStep, Math.abs(v(x, y) - v(x - 1, y)));
      expect(maxStep).toBeLessThan(12);
    });

    it('a model that returns garbage is a failed step (bad_image)', async () => {
      const out = await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 7,
        extend: async () => ({ ok: true, png: new Uint8Array([1, 2, 3, 4]) }),
        timeLeftMs: plenty,
      });
      expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
      expect(out.path).toBe('blur');
      expect(out.reasons).toEqual(['bad_image']);
    });

    it('one end fails, the other works: partial, exact size, only the failed end blurred', async () => {
      const good = fakeModel();
      const out = await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 7,
        // the end that paints to the right (strip at the left of the canvas) fails
        extend: async (req) => {
          const { data } = await sharp(req.canvas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          return data[3] === 255 ? { ok: false, reason: 'timeout' } : good(req);
        },
        timeLeftMs: plenty,
      });
      expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
      expect(out).toMatchObject({ path: 'partial', stepsOk: 1, reasons: ['timeout'] });
      const p = await pixels(out.png);
      expect(p.px(0, 100)).toEqual([...BLUE]); // the working end is painted
      expect(p.px(3359, 100)).toEqual([...GREEN]); // the failed end is a blur of the (solid) picture
    });

    it('a step that fails after some worked keeps the worked ones: 14:1 with the sixth call refused', async () => {
      const good = fakeModel();
      let n = 0;
      const out = await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 14,
        extend: async (req) => (++n === 6 ? { ok: false, reason: 'refused' } : good(req)),
        timeLeftMs: plenty,
      });
      expect([out.pxWidth, out.pxHeight]).toEqual([6720, 480]);
      expect(out.path).toBe('partial');
      expect(out.reasons).toEqual(['refused']);
      expect(out.stepsOk).toBeGreaterThanOrEqual(4);
    });

    it('does not start a call without time: nothing is sent, the whole extension is blur-filled', async () => {
      let calls = 0;
      const out = await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 7,
        extend: async () => {
          calls++;
          return { ok: false, reason: 'error' };
        },
        timeLeftMs: () => AI_MIN_EXTEND_BUDGET_MS - 1,
      });
      expect(calls).toBe(0);
      expect([out.pxWidth, out.pxHeight]).toEqual([3360, 480]);
      expect(out).toMatchObject({ path: 'blur', calls: 0, reasons: ['deadline'] });
    });

    it('the deadline is read before every call: a step that used up the time stops the next one', async () => {
      let left = 100_000;
      const good = fakeModel();
      const timeouts: number[] = [];
      const out = await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 14,
        extend: async (req) => {
          timeouts.push(req.timeoutMs);
          left -= 90_000; // each call "takes" 90 s
          return good(req);
        },
        timeLeftMs: () => left,
      });
      expect(out.reasons).toEqual(['deadline']);
      expect(out.path).toBe('partial');
      expect([out.pxWidth, out.pxHeight]).toEqual([6720, 480]);
      // The call's timeout is what is left, never more than the per-call maximum.
      expect(timeouts.every((t) => t <= AI_EXTEND_TIMEOUT_MS)).toBe(true);
      expect(timeouts.length).toBeLessThan(6);
    });

    it('the call timeout shrinks to the time left', async () => {
      const timeouts: number[] = [];
      await outpaintToAspect(await solid(W, H), {
        portrait: false,
        aspect: 7,
        extend: async (req) => {
          timeouts.push(req.timeoutMs);
          return { ok: false, reason: 'timeout' };
        },
        timeLeftMs: () => 25_000,
      });
      expect(timeouts).toEqual([25_000, 25_000]);
    });
  });

  it('the cap: 58:1 makes at most 12 calls (6 per end) and blur-fills the rest, to the exact size', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 58, extend: fakeModel(seen), timeLeftMs: plenty });
    expect(seen).toHaveLength(12);
    expect(out).toMatchObject({ path: 'partial', calls: 12, stepsOk: 12, reasons: ['cap'] });
    expect([out.pxWidth, out.pxHeight]).toEqual([Math.round(480 * 58), 480]);
  });

  it('a cap of one call per end (test hook) is honoured', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 14, extend: fakeModel(seen), timeLeftMs: plenty, maxStepsPerSide: 1 });
    expect(seen).toHaveLength(2);
    expect(out.reasons).toEqual(['cap']);
    expect(out.pxWidth).toBe(6720);
  });

  it('a ratio just over 3:1: no call, a few blurred pixels, no failure to report', async () => {
    const seen: Seen[] = [];
    const out = await outpaintToAspect(await solid(W, H), { portrait: false, aspect: 3.01, extend: fakeModel(seen), timeLeftMs: plenty });
    expect(seen).toHaveLength(0);
    expect([out.pxWidth, out.pxHeight]).toEqual([1445, 480]);
    expect(out).toMatchObject({ path: 'ai', calls: 0, reasons: [] });
  });
});

describe('fitLongPng', () => {
  async function noisy(w: number, h: number): Promise<Uint8Array> {
    const raw = Buffer.alloc(w * h * 3);
    randomFillSync(raw);
    return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
  }

  it('returns a small png as it is', async () => {
    const png = await solid(400, 100);
    const out = await fitLongPng(png, { pxWidth: 400, pxHeight: 100 }, 1_000_000);
    expect(out?.png).toBe(png);
    expect([out?.pxWidth, out?.pxHeight]).toEqual([400, 100]);
  });

  it('shrinks a too-large (noisy) picture until it fits, keeping its ratio', async () => {
    const png = await noisy(1600, 160);
    expect(png.byteLength).toBeGreaterThan(300_000);
    const out = await fitLongPng(png, { pxWidth: 1600, pxHeight: 160 }, 300_000);
    expect(out).not.toBeNull();
    expect(out!.png.byteLength).toBeLessThanOrEqual(300_000);
    const meta = await sharp(out!.png).metadata();
    expect([meta.width, meta.height]).toEqual([out!.pxWidth, out!.pxHeight]);
    expect(Math.abs(out!.pxWidth / out!.pxHeight - 10)).toBeLessThan(0.2);
  });

  it('keeps the ratio to within 1e-4 when it scales, landscape and portrait (the builder derives the sticker size from it)', async () => {
    const land = await noisy(3001, 163);
    const a = await fitLongPng(land, { pxWidth: 3001, pxHeight: 163 }, 120_000);
    expect(a).not.toBeNull();
    expect(a!.pxWidth).toBeLessThan(3001);
    // Rounding the short side only: the long side follows the ratio to within half a pixel.
    expect(Math.abs(a!.pxWidth - (a!.pxHeight * 3001) / 163)).toBeLessThanOrEqual(0.5);
    const tall = await noisy(163, 3001);
    const b = await fitLongPng(tall, { pxWidth: 163, pxHeight: 3001 }, 120_000);
    expect(b).not.toBeNull();
    expect(b!.pxHeight).toBeLessThan(3001);
    expect(Math.abs(b!.pxHeight - (b!.pxWidth * 3001) / 163)).toBeLessThanOrEqual(0.5);
    const meta = await sharp(b!.png).metadata();
    expect([meta.width, meta.height]).toEqual([b!.pxWidth, b!.pxHeight]);
  }, 30_000);

  it('uses the cheaper encodings first and returns THEIR bytes even when given a bigger object (the service passes its picture)', async () => {
    // A smooth gradient: huge as a default PNG? no, but a noisy-ish photo-like picture shrinks a lot with maximum compression / a palette.
    const w = 1200;
    const h = 120;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 3 + y) % 256, (x + y * 5) % 256, (x * 7) % 256], (y * w + x) * 3);
    const png = new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
    const norm = { png, pxWidth: w, pxHeight: h };
    const max = Math.floor(png.byteLength / 3);
    const out = await fitLongPng(png, norm, max);
    expect(out).not.toBeNull();
    expect(out!.png).not.toBe(png);
    expect(out!.png.byteLength).toBeLessThanOrEqual(max);
    expect([out!.pxWidth, out!.pxHeight]).toEqual([w, h]); // not scaled: a cheaper encoding was enough
  });

  it('null when nothing fits', async () => {
    const png = await noisy(800, 80);
    expect(await fitLongPng(png, { pxWidth: 800, pxHeight: 80 }, 10)).toBeNull();
  });
});
