import 'server-only';
/**
 * Long rectangles (longer than AI_MAX_ASPECT : 1): the image model draws a 3:1 canvas, this module continues the
 * picture on its two short ends with more model calls (OpenAI /images/edits, "outpainting") so the whole sticker is one
 * picture. The old way (repeating the edge pixels) made stripes whenever an object touched the edge.
 *
 * One step: a 1424x480 canvas, fully transparent, with the outer KEEP px of the current picture pasted at the edge that
 * touches it; the model paints the empty part. The new part (CANVAS - KEEP px) plus FEATHER px of overlap is blended onto
 * the picture with a linear alpha ramp. Each end repeats this on its own (steps in order, the two ends side by side);
 * the last step of an end takes only the pixels still needed. A portrait sticker is the same with the axes swapped: the
 * picture is turned to landscape for the arithmetic and the canvas is turned back to portrait for the model.
 *
 * FAILURE POLICY: any failed step (error, timeout, moderation block), the per-end cap or the deadline stops that end.
 * Whatever is still missing is BLUR-FILLED (never stripes): a heavily blurred copy of the picture, scaled evenly to the
 * full length, with the sharp picture on top and a feathered edge where it ends short. The generation still succeeds.
 *
 * Customer reference images never reach this module: its only input is the already generated picture.
 */
import sharp from 'sharp';
import {
  AI_EXTEND_TIMEOUT_MS,
  AI_MIN_EXTEND_BUDGET_MS,
  AI_OUTPAINT_CANVAS_LONG as W,
  AI_OUTPAINT_CANVAS_SHORT as H,
  AI_OUTPAINT_FEATHER_PX as F,
  AI_OUTPAINT_KEEP_PX as KEEP,
  AI_OUTPAINT_MIN_END_PX,
} from './config';
import { INPUT } from './normalise';
import type { AiFailure } from './openai';
import { planOutpaint, type OutpaintPlan } from './outpaint-plan';
import { buildExtendPrompt } from './prompt-template';

/** One extension call (src/lib/ai/openai.ts extendImage with the key bound), injected so tests need no network. */
export type ExtendCall = (req: {
  prompt: string;
  size: string;
  canvas: Uint8Array;
  timeoutMs: number;
}) => Promise<{ ok: true; png: Uint8Array } | { ok: false; reason: AiFailure }>;

export interface OutpaintOptions {
  /** From the STICKER (height > width), never from the returned picture. */
  portrait: boolean;
  /** Long side : short side of the sticker (> AI_MAX_ASPECT). */
  aspect: number;
  extend: ExtendCall;
  /** Milliseconds left before the extension deadline (the route's time budget less the safety margins). */
  timeLeftMs: () => number;
  /** Test hook; defaults to AI_MAX_EXTEND_STEPS_PER_SIDE. */
  maxStepsPerSide?: number;
}

/** 'ai': every end painted by the model; 'partial': some steps worked, the rest blur-filled; 'blur': no step worked. */
export type OutpaintPath = 'ai' | 'partial' | 'blur';

export interface OutpaintResult {
  png: Uint8Array;
  pxWidth: number;
  pxHeight: number;
  path: OutpaintPath;
  /** Extension calls made (paid), and how many of them were used. */
  calls: number;
  stepsOk: number;
  /** Why the model did not paint everything: 'refused' | 'timeout' | 'error' | 'bad_image' | 'internal' | 'deadline' | 'cap'. Empty for 'ai'. */
  reasons: string[];
}

/* ───────────────────────────── Pixels: RGB strips, H rows ───────────────────────────── */

interface Strip {
  /** RGB, row-major, `width` * 3 bytes per row, H rows. */
  data: Buffer;
  width: number;
}

const rowBytes = (width: number): number => width * 3;

/** Columns [x0, x0 + w) of a strip (a copy). */
function cols(src: Strip, x0: number, w: number): Strip {
  const out = Buffer.allocUnsafe(rowBytes(w) * H);
  for (let y = 0; y < H; y++) {
    const from = y * rowBytes(src.width) + x0 * 3;
    src.data.copy(out, y * rowBytes(w), from, from + rowBytes(w));
  }
  return { data: out, width: w };
}

/** The strips side by side. */
function join(parts: Strip[]): Strip {
  const width = parts.reduce((n, p) => n + p.width, 0);
  const out = Buffer.allocUnsafe(rowBytes(width) * H);
  for (let y = 0; y < H; y++) {
    let x = 0;
    for (const p of parts) {
      p.data.copy(out, y * rowBytes(width) + x * 3, y * rowBytes(p.width), (y + 1) * rowBytes(p.width));
      x += p.width;
    }
  }
  return { data: out, width };
}

/** dst = dst * (1 - a) + src * a for one RGB pixel. */
function blend(dst: Buffer, di: number, src: Buffer, si: number, a: number): void {
  for (let c = 0; c < 3; c++) dst[di + c] = Math.round(dst[di + c] * (1 - a) + src[si + c] * a);
}

/** Raw RGB (any size) → a W x H landscape strip; a different size is stretched (the model returns the size asked for). */
async function toStrip(input: Uint8Array, turn: boolean): Promise<Strip> {
  let p = sharp(input, INPUT).flatten({ background: '#ffffff' }).removeAlpha();
  // The rectangle's long axis is the picture's x axis here: a portrait picture is turned counter-clockwise (top → left).
  if (turn) p = p.rotate(270);
  const { data, info } = await p.raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('outpaint: expected 3 channels');
  if (info.width === W && info.height === H) return { data, width: W };
  const fit = await sharp(data, { ...INPUT, raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(W, H, { fit: 'fill' })
    .raw()
    .toBuffer();
  return { data: fit, width: W };
}

/** Encodes a strip (RGB) as a PNG; `turn` = portrait: turned clockwise so the long axis is vertical again. */
async function strip2png(s: Strip, turn: boolean): Promise<Uint8Array> {
  let p = sharp(s.data, { ...INPUT, raw: { width: s.width, height: H, channels: 3 } });
  if (turn) p = p.rotate(90);
  return new Uint8Array(await p.png().toBuffer());
}

/* ───────────────────────────── One end ───────────────────────────── */

type Side = 'start' | 'end';

/** The canvas of one step: transparent, the outer KEEP px of `arm` at the edge that touches the empty part. */
async function stepCanvas(arm: Strip, side: Side, turn: boolean): Promise<Uint8Array> {
  const keep = side === 'end' ? cols(arm, arm.width - KEEP, KEEP) : cols(arm, 0, KEEP);
  const x0 = side === 'end' ? 0 : W - KEEP;
  const rgba = Buffer.alloc(W * H * 4); // all zero = fully transparent
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < KEEP; x++) {
      const si = y * rowBytes(KEEP) + x * 3;
      const di = (y * W + x0 + x) * 4;
      rgba[di] = keep.data[si];
      rgba[di + 1] = keep.data[si + 1];
      rgba[di + 2] = keep.data[si + 2];
      rgba[di + 3] = 255;
    }
  }
  let p = sharp(rgba, { ...INPUT, raw: { width: W, height: H, channels: 4 } });
  if (turn) p = p.rotate(90);
  return new Uint8Array(await p.png().toBuffer());
}

/** Blends the model's new part (`n` px) onto `arm` at its outer end: FEATHER px of linear ramp over the old pixels, then the new ones. */
function applyStep(arm: Strip, side: Side, gen: Strip, n: number): Strip {
  const aw = arm.width;
  const out = Buffer.allocUnsafe(rowBytes(aw + n) * H);
  for (let y = 0; y < H; y++) {
    const o = y * rowBytes(aw + n);
    const a = y * rowBytes(aw);
    const g = y * rowBytes(W);
    if (side === 'end') {
      // arm cols [0, aw - F) untouched, [aw - F, aw) ramp to the model's picture, then n new columns.
      arm.data.copy(out, o, a, a + rowBytes(aw));
      for (let i = 0; i < F; i++) {
        blend(out, o + (aw - F + i) * 3, gen.data, g + (KEEP - F + i) * 3, (i + 1) / (F + 1));
      }
      gen.data.copy(out, o + aw * 3, g + KEEP * 3, g + (KEEP + n) * 3);
    } else {
      // n new columns, then F columns ramping from the model's picture to the old ones, then the rest of the arm.
      gen.data.copy(out, o, g + (W - KEEP - n) * 3, g + (W - KEEP) * 3);
      arm.data.copy(out, o + (n + F) * 3, a + F * 3, a + rowBytes(aw));
      for (let i = 0; i < F; i++) {
        const px = o + (n + i) * 3;
        arm.data.copy(out, px, a + i * 3, a + i * 3 + 3);
        blend(out, px, gen.data, g + (W - KEEP + i) * 3, 1 - (i + 1) / (F + 1));
      }
    }
  }
  return { data: out, width: aw + n };
}

interface ArmOutcome {
  arm: Strip;
  added: number;
  calls: number;
  stepsOk: number;
  reason?: string;
}

async function growArm(
  side: Side,
  arm0: Strip,
  steps: readonly number[],
  o: Pick<OutpaintOptions, 'portrait' | 'extend' | 'timeLeftMs'>,
): Promise<ArmOutcome> {
  const out: ArmOutcome = { arm: arm0, added: 0, calls: 0, stepsOk: 0 };
  const size = o.portrait ? `${H}x${W}` : `${W}x${H}`;
  const prompt = buildExtendPrompt(o.portrait, side);
  for (const n of steps) {
    // Never start a call that cannot finish before the deadline.
    const left = o.timeLeftMs();
    if (left < AI_MIN_EXTEND_BUDGET_MS) {
      out.reason = 'deadline';
      break;
    }
    try {
      const canvas = await stepCanvas(out.arm, side, o.portrait);
      out.calls++;
      const res = await o.extend({ prompt, size, canvas, timeoutMs: Math.min(AI_EXTEND_TIMEOUT_MS, left) });
      if (!res.ok) {
        out.reason = res.reason;
        break;
      }
      let gen: Strip;
      try {
        gen = await toStrip(res.png, o.portrait);
      } catch {
        out.reason = 'bad_image';
        break;
      }
      out.arm = applyStep(out.arm, side, gen, n);
      out.added += n;
      out.stepsOk++;
    } catch {
      out.reason = 'internal';
      break;
    }
  }
  return out;
}

/* ───────────────────────────── Blur fill ───────────────────────────── */

/**
 * `cur` placed in a picture `missStart + cur.width + missEnd` wide: the background is a heavily blurred copy of `cur`
 * scaled evenly (cover) to the full length; `cur` goes on top, feathered (linear alpha ramp) only at an end that is short.
 */
async function blurFill(cur: Strip, missStart: number, missEnd: number): Promise<Strip> {
  const total = cur.width + missStart + missEnd;
  // Fit 'cover': both axes are scaled by the same factor (the long axis stretches to `total`, the rows outside the middle are
  // cropped), so no object is smeared into a long band. Blurring a small copy and scaling it back up gives the same soft
  // result as a heavy blur (sigma 40) of the full size at a fraction of the cost; the cover crop happens in the small copy.
  const smallW = Math.max(1, Math.round(total / 8));
  const smallH = Math.round(H / 8);
  const small = await sharp(cur.data, { ...INPUT, raw: { width: cur.width, height: H, channels: 3 } })
    .resize(smallW, smallH, { fit: 'cover' })
    .blur(5)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bg = await sharp(small.data, { ...INPUT, raw: { width: small.info.width, height: small.info.height, channels: 3 } })
    .resize(total, H, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  const ramp = Math.min(F, Math.floor(cur.width / 4));
  const rs = missStart > 0 ? ramp : 0;
  const re = missEnd > 0 ? ramp : 0;
  for (let y = 0; y < H; y++) {
    const o = y * rowBytes(total) + missStart * 3;
    const c = y * rowBytes(cur.width);
    for (let i = 0; i < rs; i++) blend(bg, o + i * 3, cur.data, c + i * 3, (i + 1) / (ramp + 1));
    cur.data.copy(bg, o + rs * 3, c + rs * 3, c + (cur.width - re) * 3);
    for (let i = 0; i < re; i++) {
      const x = cur.width - re + i;
      blend(bg, o + x * 3, cur.data, c + x * 3, (ramp - i) / (ramp + 1));
    }
  }
  return { data: bg, width: total };
}

/* ───────────────────────────── Entry point ───────────────────────────── */

/**
 * Grows `png` (the opaque picture from normaliseGenerated, drawn at the model's 3:1 canvas) to the sticker's ratio:
 * exactly round(480 * aspect) px long (never over AI_MAX_EXTENDED_SIDE) and 480 px short. Never fails because of the
 * model: a failed end is blur-filled (see the file header). Throws only on unreadable pixels or an internal bug.
 */
export async function outpaintToAspect(png: Uint8Array, opts: OutpaintOptions): Promise<OutpaintResult> {
  const plan: OutpaintPlan = planOutpaint(W, H, opts.aspect, opts.maxStepsPerSide);
  const base = await toStrip(png, opts.portrait);

  const [s, e] = await Promise.all([
    growArm('start', cols(base, 0, KEEP), plan.start.steps, opts),
    growArm('end', cols(base, W - KEEP, KEEP), plan.end.steps, opts),
  ]);
  const current = join([s.arm, cols(base, KEEP, W - 2 * KEEP), e.arm]);

  const missStart = plan.start.need - s.added;
  const missEnd = plan.end.need - e.added;
  const done = missStart + missEnd > 0 ? await blurFill(current, missStart, missEnd) : current;

  const reasons = new Set<string>();
  for (const r of [s.reason, e.reason]) if (r) reasons.add(r);
  // The cap (or a picture too short to hold two strips) left an end the calls did not reach; a small remainder is not a failure.
  for (const side of [plan.start, plan.end]) if (side.missing >= AI_OUTPAINT_MIN_END_PX) reasons.add('cap');
  const stepsOk = s.stepsOk + e.stepsOk;
  const path: OutpaintPath = reasons.size === 0 ? 'ai' : stepsOk > 0 ? 'partial' : 'blur';

  return {
    png: await strip2png(done, opts.portrait),
    pxWidth: opts.portrait ? H : done.width,
    pxHeight: opts.portrait ? done.width : H,
    path,
    calls: s.calls + e.calls,
    stepsOk,
    reasons: [...reasons],
  };
}

/* ───────────────────────────── Size budget ───────────────────────────── */

/**
 * A long picture painted by the model does not compress like repeated edge pixels did: 14:1 is about 4.5 MB as a PNG.
 * Fits `png` (an opaque RGB PNG of pxWidth x pxHeight) into `maxBytes` in this order, keeping the most pixels: as it is;
 * maximum compression (only when it is under 1.6 x the budget); a 256-colour palette PNG; then scaled down (a few tries).
 * null when nothing fits.
 */
export async function fitLongPng(
  png: Uint8Array,
  size: { pxWidth: number; pxHeight: number },
  maxBytes: number,
): Promise<{ png: Uint8Array; pxWidth: number; pxHeight: number } | null> {
  // `size` may be a bigger object (the service passes its normalised picture, `png` included): take only the two fields.
  const { pxWidth, pxHeight } = size;
  if (png.byteLength <= maxBytes) return { png, pxWidth, pxHeight };
  // The lossless re-encode takes seconds on a long picture and gains about half at best: only worth trying when it can reach the budget.
  if (png.byteLength <= maxBytes * 1.6) {
    const tight = await sharp(png, INPUT).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    if (tight.byteLength <= maxBytes) return { png: new Uint8Array(tight), pxWidth, pxHeight };
  }

  const palette = { palette: true, quality: 90, effort: 7, compressionLevel: 9 } as const;
  const pal = await sharp(png, INPUT).png(palette).toBuffer();
  if (pal.byteLength <= maxBytes) return { png: new Uint8Array(pal), pxWidth, pxHeight };

  let bytes = pal.byteLength;
  let scale = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    scale *= Math.min(0.95, Math.sqrt(maxBytes / bytes) * 0.92);
    // Round the SHORT side, then derive the long side from the original ratio: the builder sets the sticker size from this
    // ratio, so rounding both sides separately could move the customer's typed size (e.g. below the minimum side).
    const landscape = pxWidth >= pxHeight;
    const short = Math.max(1, Math.round(Math.min(pxWidth, pxHeight) * scale));
    const long = Math.max(1, Math.round((short * Math.max(pxWidth, pxHeight)) / Math.min(pxWidth, pxHeight)));
    const w = landscape ? long : short;
    const h = landscape ? short : long;
    const out = await sharp(png, INPUT).resize(w, h, { fit: 'fill' }).png(palette).toBuffer();
    if (out.byteLength <= maxBytes) return { png: new Uint8Array(out), pxWidth: w, pxHeight: h };
    bytes = out.byteLength;
  }
  return null;
}
