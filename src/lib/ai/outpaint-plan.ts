/**
 * The plan of an outpainting run (src/lib/ai/outpaint.ts): how many extension calls each end of a long rectangle
 * needs, and how many pixels each adds. Pure arithmetic on plain constants, so it is browser-safe (no server-only):
 * the builder uses it to scale the progress bar by the same step count the server will plan.
 */
import type { Shape } from '../types';
import {
  AI_MAX_ASPECT,
  AI_MAX_EXTEND_STEPS_PER_SIDE,
  AI_MAX_EXTENDED_SIDE,
  AI_OUTPAINT_CANVAS_LONG,
  AI_OUTPAINT_CANVAS_SHORT,
  AI_OUTPAINT_KEEP_PX,
  AI_OUTPAINT_MIN_END_PX,
} from './config';

/** New pixels one extension call adds (the canvas less the strip of the current picture it holds). */
export const OUTPAINT_STEP_PX = AI_OUTPAINT_CANVAS_LONG - AI_OUTPAINT_KEEP_PX;

export interface SidePlan {
  /** Pixels this end needs in all. */
  need: number;
  /** Pixels each extension call adds, in call order (all OUTPAINT_STEP_PX except possibly the last). */
  steps: number[];
  /** Pixels the calls will not cover (over the cap, or too small a remainder): blur-filled. */
  missing: number;
}

export interface OutpaintPlan {
  /** Long side of the finished picture; baseLong + start.need + end.need. */
  targetLong: number;
  /** The end at the left (landscape) or the top (portrait). */
  start: SidePlan;
  /** The end at the right (landscape) or the bottom (portrait). */
  end: SidePlan;
}

function planSide(need: number, maxSteps: number): SidePlan {
  const steps: number[] = [];
  let left = need;
  // The last call takes only the pixels still needed; a remainder under AI_OUTPAINT_MIN_END_PX is not worth a call.
  while (left >= AI_OUTPAINT_MIN_END_PX && steps.length < maxSteps) {
    const take = Math.min(OUTPAINT_STEP_PX, left);
    steps.push(take);
    left -= take;
  }
  return { need, steps, missing: left };
}

/**
 * Plan for a picture `baseLong` x `baseShort` px (the model's canvas) that must reach `aspect` (long : short of the
 * sticker). The extra length is split equally on the two ends (the start gets the smaller half). The target long side
 * is round(baseShort * aspect), never over AI_MAX_EXTENDED_SIDE. A picture too short to hold two strips gets no calls.
 */
export function planOutpaint(
  baseLong: number,
  baseShort: number,
  aspect: number,
  maxStepsPerSide: number = AI_MAX_EXTEND_STEPS_PER_SIDE,
): OutpaintPlan {
  const wanted = Math.min(Math.round(baseShort * aspect), AI_MAX_EXTENDED_SIDE);
  const extra = Math.max(0, wanted - baseLong);
  const startNeed = Math.floor(extra / 2);
  const endNeed = extra - startNeed;
  const canExtend = baseLong >= 2 * AI_OUTPAINT_KEEP_PX;
  const cap = canExtend ? maxStepsPerSide : 0;
  return {
    targetLong: baseLong + extra,
    start: planSide(startNeed, cap),
    end: planSide(endNeed, cap),
  };
}

/** Extension calls of the longer end (the two ends run side by side): what the wait scales with. 0 when no call is made. */
export function extendStepsOf(plan: OutpaintPlan): number {
  return Math.max(plan.start.steps.length, plan.end.steps.length);
}

/**
 * What the builder can know before asking: the extension calls of the longer end for a sticker of this shape and size,
 * planned on the model's canvas. 0 for everything but a rectangle longer than AI_MAX_ASPECT : 1.
 */
export function expectedExtendSteps(shape: Shape | null, widthUm: number, heightUm: number): number {
  if (shape !== 'rect' || !(widthUm > 0) || !(heightUm > 0)) return 0;
  const aspect = Math.max(widthUm, heightUm) / Math.min(widthUm, heightUm);
  if (!(aspect > AI_MAX_ASPECT)) return 0;
  return extendStepsOf(planOutpaint(AI_OUTPAINT_CANVAS_LONG, AI_OUTPAINT_CANVAS_SHORT, aspect));
}
