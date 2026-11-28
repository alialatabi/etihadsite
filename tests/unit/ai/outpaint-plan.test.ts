import { describe, expect, it } from 'vitest';
import {
  AI_MAX_EXTEND_STEPS_PER_SIDE,
  AI_MAX_EXTENDED_SIDE,
  AI_OUTPAINT_CANVAS_LONG,
  AI_OUTPAINT_CANVAS_SHORT,
  AI_OUTPAINT_FEATHER_PX,
  AI_OUTPAINT_KEEP_PX,
  AI_OUTPAINT_MIN_END_PX,
} from '@/lib/ai/config';
import { OUTPAINT_STEP_PX, expectedExtendSteps, extendStepsOf, planOutpaint } from '@/lib/ai/outpaint-plan';
import { imageRequestSize } from '@/lib/ai/prompt-template';

const W = AI_OUTPAINT_CANVAS_LONG;
const H = AI_OUTPAINT_CANVAS_SHORT;

describe('outpaint constants', () => {
  it('the canvas is exactly what the main call asks for at a ratio over 3:1 (they cannot drift apart)', () => {
    expect(imageRequestSize('rect', 280_000, 40_000).size).toBe(`${W}x${H}`);
    expect(imageRequestSize('rect', 40_000, 280_000).size).toBe(`${H}x${W}`);
  });

  it('the canvas is a legal model size (ratio at most 3, multiples of 16) and holds the strip, the step and the feather', () => {
    expect(W / H).toBeLessThanOrEqual(3);
    expect(W % 16).toBe(0);
    expect(H % 16).toBe(0);
    expect(OUTPAINT_STEP_PX).toBe(968);
    expect(AI_OUTPAINT_KEEP_PX).toBeGreaterThan(AI_OUTPAINT_FEATHER_PX);
    expect(2 * AI_OUTPAINT_KEEP_PX).toBeLessThanOrEqual(W);
  });
});

describe('planOutpaint', () => {
  it('7:1 → 3360 px, one call of 968 px at each end', () => {
    const p = planOutpaint(W, H, 7);
    expect(p.targetLong).toBe(3360);
    expect(p.start).toEqual({ need: 968, steps: [968], missing: 0 });
    expect(p.end).toEqual({ need: 968, steps: [968], missing: 0 });
    expect(extendStepsOf(p)).toBe(1);
  });

  it('14:1 → 6720 px, two calls at each end, the last takes only what is left', () => {
    const p = planOutpaint(W, H, 14);
    expect(p.targetLong).toBe(6720);
    expect(p.start.need).toBe(2648);
    expect(p.start.steps).toEqual([968, 968, 712]);
    expect(p.end.steps).toEqual([968, 968, 712]);
    expect(p.start.missing + p.end.missing).toBe(0);
    expect(p.start.need + p.end.need + W).toBe(p.targetLong);
  });

  it('an odd extra gives the end the extra pixel', () => {
    const q = planOutpaint(W, H, 9.0021); // round(480 * 9.0021) = 4321: 2897 more, an odd number
    expect((q.targetLong - W) % 2).toBe(1);
    expect(q.targetLong - W).toBe(q.start.need + q.end.need);
    expect(q.end.need - q.start.need).toBe(1);
  });

  it('at exactly 3:1 or less no call is planned (the service never asks for a plan at 3:1 or less)', () => {
    for (const aspect of [3, 2, 1]) {
      const p = planOutpaint(W, H, aspect);
      expect(p.start.steps).toEqual([]);
      expect(p.end.steps).toEqual([]);
      expect(p.targetLong).toBe(Math.max(W, Math.round(H * aspect)));
      expect(extendStepsOf(p)).toBe(0);
    }
  });

  it('a ratio just over 3:1 needs no paid call (the few pixels are blur-filled)', () => {
    const p = planOutpaint(W, H, 3.01);
    expect(p.targetLong).toBe(1445);
    expect(p.start.steps).toEqual([]);
    expect(p.end.steps).toEqual([]);
    expect(p.start.missing + p.end.missing).toBe(21);
    expect(extendStepsOf(p)).toBe(0);
  });

  it('a remainder under the minimum is blur-filled instead of paying for a tiny call', () => {
    // each end needs 968 + 32
    const p = planOutpaint(W, H, (W + 2 * (968 + 32)) / H);
    expect(p.start.steps).toEqual([968]);
    expect(p.start.missing).toBe(32);
    expect(32).toBeLessThan(AI_OUTPAINT_MIN_END_PX);
  });

  it('the cap: at most AI_MAX_EXTEND_STEPS_PER_SIDE calls per end, the rest is missing', () => {
    const p = planOutpaint(W, H, 58);
    expect(p.start.steps).toHaveLength(AI_MAX_EXTEND_STEPS_PER_SIDE);
    expect(p.end.steps).toHaveLength(AI_MAX_EXTEND_STEPS_PER_SIDE);
    expect(p.start.steps.every((n) => n === OUTPAINT_STEP_PX)).toBe(true);
    expect(p.start.missing).toBe(p.start.need - AI_MAX_EXTEND_STEPS_PER_SIDE * OUTPAINT_STEP_PX);
    expect(p.start.missing).toBeGreaterThan(0);
    // 13 calls at most in all (the main one and 2 x 6)
    expect(p.start.steps.length + p.end.steps.length).toBe(12);
  });

  it('honours a smaller cap', () => {
    const p = planOutpaint(W, H, 14, 1);
    expect(p.start.steps).toEqual([968]);
    expect(p.end.steps).toEqual([968]);
    expect(p.start.missing).toBe(2648 - 968);
  });

  it('the target never goes over the maximum side', () => {
    const p = planOutpaint(W, H, 400_000);
    expect(p.targetLong).toBe(AI_MAX_EXTENDED_SIDE);
    expect(p.start.steps).toHaveLength(AI_MAX_EXTEND_STEPS_PER_SIDE);
  });

  it('a picture too short to hold two strips gets no calls', () => {
    const p = planOutpaint(2 * AI_OUTPAINT_KEEP_PX - 1, H, 10);
    expect(p.start.steps).toEqual([]);
    expect(p.end.steps).toEqual([]);
    expect(p.start.missing + p.end.missing).toBe(p.targetLong - (2 * AI_OUTPAINT_KEEP_PX - 1));
  });
});

describe('expectedExtendSteps (what the builder can know)', () => {
  it('0 for everything but a rectangle longer than 3:1', () => {
    expect(expectedExtendSteps('circle', 50_000, 50_000)).toBe(0);
    expect(expectedExtendSteps('custom', 280_000, 10_000)).toBe(0);
    expect(expectedExtendSteps(null, 280_000, 10_000)).toBe(0);
    expect(expectedExtendSteps('rect', 150_000, 50_000)).toBe(0);
    expect(expectedExtendSteps('rect', 0, 50_000)).toBe(0);
    expect(expectedExtendSteps('rect', 150_000, 49_000)).toBe(0); // 3.06:1: too few pixels for a paid call
  });

  it('counts the calls of the longer end, either orientation', () => {
    expect(expectedExtendSteps('rect', 70_000, 10_000)).toBe(1);
    expect(expectedExtendSteps('rect', 10_000, 70_000)).toBe(1);
    expect(expectedExtendSteps('rect', 140_000, 10_000)).toBe(3);
    expect(expectedExtendSteps('rect', 291_000, 5_000)).toBe(AI_MAX_EXTEND_STEPS_PER_SIDE);
  });
});
