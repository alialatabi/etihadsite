import { builder } from '@/content/ar';

/** Which wait the bar estimates: the brief call (page 1) or the image call (design step / staff page). */
export type ProgressKind = 'brief' | 'image';

/** The bar never reaches this before the answer arrives (R7: progress is estimated). */
export const PROGRESS_CAP = 95;
/** How often AiProgress re-reads the clock. */
export const PROGRESS_TICK_MS = 500;

/** Time constant of the curve: fast at first, then slower and slower. */
export const PROGRESS_TAU_MS: Record<ProgressKind, number> = { brief: 4_000, image: 30_000 };

/** When each stage text starts (ms since the request began); index = index in builder.ai.progress[kind]. */
export const PROGRESS_STAGE_STARTS_MS: Record<ProgressKind, readonly number[]> = {
  brief: [0, 3_000],
  image: [0, 8_000, 25_000, 45_000],
};

/** From this elapsed time on, the stage text gives way to builder.ai.progress.slow. */
export const PROGRESS_SLOW_AFTER_MS: Record<ProgressKind, number> = { brief: 15_000, image: 70_000 };

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

/** Estimated progress after `elapsedMs` of waiting. Negative / NaN → 0; Infinity stays under the cap. */
export function progressAt(elapsedMs: number, kind: ProgressKind): ProgressState {
  const t = elapsedMs > 0 ? elapsedMs : 0; // NaN > 0 is false
  const percent = Math.min(PROGRESS_CAP * -Math.expm1(-t / PROGRESS_TAU_MS[kind]), MAX_PERCENT);
  const starts = PROGRESS_STAGE_STARTS_MS[kind];
  let stageIndex = 0;
  for (let i = 1; i < starts.length; i++) if (t >= starts[i]) stageIndex = i;
  stageIndex = Math.min(stageIndex, PROGRESS_STAGE_COUNT[kind] - 1);
  return { percent, stageIndex, slow: t >= PROGRESS_SLOW_AFTER_MS[kind] };
}
