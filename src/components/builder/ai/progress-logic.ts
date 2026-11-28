import { builder } from '@/content/ar';

/** Which wait the bar estimates: the brief call (page 1) or the image call (design step / staff page). */
export type ProgressKind = 'brief' | 'image';

/** The bar never reaches this before the answer arrives (R7: progress is estimated). */
export const PROGRESS_CAP = 95;
/** How often AiProgress re-reads the clock. */
export const PROGRESS_TICK_MS = 500;

/**
 * Starts the clock of one AiProgress: reports the elapsed time since `start` once right away (a zero-delay timer,
 * so a bar that remounts mid-request shows its real place on the first frame, not 0 % for a tick) and then every
 * PROGRESS_TICK_MS. Elapsed is read from the clock, not counted in ticks: background tabs throttle intervals.
 * Returns the stop function.
 */
export function startProgressClock(start: number, onElapsed: (ms: number) => void): () => void {
  const tick = () => onElapsed(Math.max(0, Date.now() - start));
  const first = setTimeout(tick, 0);
  const id = setInterval(tick, PROGRESS_TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(id);
  };
}

/** Time constant of the curve: fast at first, then slower and slower. */
export const PROGRESS_TAU_MS: Record<ProgressKind, number> = { brief: 4_000, image: 30_000 };

/** When each stage text starts (ms since the request began); index = index in builder.ai.progress[kind]. */
export const PROGRESS_STAGE_STARTS_MS: Record<ProgressKind, readonly number[]> = {
  brief: [0, 3_000],
  image: [0, 8_000, 25_000, 45_000],
};

/** From this elapsed time on, the stage text gives way to builder.ai.progress.slow. */
export const PROGRESS_SLOW_AFTER_MS: Record<ProgressKind, number> = { brief: 15_000, image: 70_000 };

/**
 * A long rectangle is painted in extra calls (src/lib/ai/outpaint-plan.ts): per call of the longer end (the two ends run
 * side by side) about this much more waiting. It stretches the curve and delays the last stages and the "slow" text.
 */
export const PROGRESS_EXTEND_STEP_MS = 10_000;

/** Number of stage texts, taken from the copy (never hard-coded). */
export const PROGRESS_STAGE_COUNT: Record<ProgressKind, number> = {
  brief: builder.ai.progress.brief.length,
  image: builder.ai.progress.image.length,
};

/** Just under the cap: in doubles 95·(1−e^−x) would reach exactly 95 for large x. */
const MAX_PERCENT = PROGRESS_CAP - 1e-6;

export interface ProgressState {
  /** 0 ≤ percent < 95, unrounded (the bar width). */
  percent: number;
  /** Index into builder.ai.progress[kind]. */
  stageIndex: number;
  /** The wait is longer than usual: show builder.ai.progress.slow. */
  slow: boolean;
}

/**
 * Estimated progress after `elapsedMs` of waiting. Negative / NaN → 0; Infinity stays under the cap.
 * `extendSteps`: the extension calls of a long rectangle (expectedExtendSteps), image kind only; the default 0 is the
 * plain single-call curve. The stages from the third on start later, and the "slow" text comes later, by that much waiting.
 */
export function progressAt(elapsedMs: number, kind: ProgressKind, extendSteps: number = 0): ProgressState {
  const t = elapsedMs > 0 ? elapsedMs : 0; // NaN > 0 is false
  const extra = kind === 'image' && extendSteps > 0 ? extendSteps * PROGRESS_EXTEND_STEP_MS : 0;
  const percent = Math.min(PROGRESS_CAP * -Math.expm1(-t / (PROGRESS_TAU_MS[kind] + extra)), MAX_PERCENT);
  const starts = PROGRESS_STAGE_STARTS_MS[kind];
  let stageIndex = 0;
  for (let i = 1; i < starts.length; i++) if (t >= starts[i] + (i >= 2 ? extra : 0)) stageIndex = i;
  stageIndex = Math.min(stageIndex, PROGRESS_STAGE_COUNT[kind] - 1);
  return { percent, stageIndex, slow: t >= PROGRESS_SLOW_AFTER_MS[kind] + 2 * extra };
}
