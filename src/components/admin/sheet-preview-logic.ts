/** Pure helpers for SheetPdfPreview (no DOM, no pdfjs): sizing and the one-at-a-time render queue. */

export type PreviewVariant = 'thumb' | 'large';

/** Canvas width in CSS px that each variant is rendered for (the element itself is w-full). */
export const PREVIEW_CSS_WIDTH: Record<PreviewVariant, number> = { thumb: 120, large: 800 };

/** A4 portrait, used for the placeholder box so the layout does not jump. */
export const SHEET_ASPECT = { width: 210, height: 297 } as const;

/** Device pixel ratio clamped to 1..2 (a phone at 3x would triple the canvas for no visible gain). */
export function clampDpr(dpr: number | undefined): number {
  if (typeof dpr !== 'number' || !Number.isFinite(dpr)) return 1;
  return Math.min(2, Math.max(1, dpr));
}

/** Pixel width of the canvas to draw for a variant. */
export function previewCanvasWidth(variant: PreviewVariant, dpr: number | undefined): number {
  return Math.round(PREVIEW_CSS_WIDTH[variant] * clampDpr(dpr));
}

export class QueueAbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export type SerialQueue = <T>(job: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

/**
 * Runs jobs strictly one after another, in the order they were added. A job whose `signal` is already
 * aborted when its turn comes is skipped (rejects with an AbortError) without running. A failing job
 * never blocks the ones behind it.
 */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return (job, signal) => {
    const result = tail.then(() => {
      if (signal?.aborted) throw new QueueAbortError();
      return job();
    });
    tail = result.catch(() => undefined);
    return result;
  };
}

/** How long one preview job (fetch + rasterise) may run before it gives up, so a stalled download cannot block the queue. */
export const PREVIEW_JOB_TIMEOUT_MS = 20_000;

export type JobSignal = {
  /** Aborts when the parent aborts or the time limit passes. */
  signal: AbortSignal;
  /** True only if the time limit (not the parent) ended the job. */
  timedOut: () => boolean;
  /** Clears the timer and the parent listener. Call in `finally`. */
  dispose: () => void;
};

/** A child AbortSignal that follows `parent` and also aborts after `ms`. */
export function createJobSignal(parent: AbortSignal, ms: number = PREVIEW_JOB_TIMEOUT_MS): JobSignal {
  const ac = new AbortController();
  let timed = false;
  const onParent = () => ac.abort();
  if (parent.aborted) ac.abort();
  else parent.addEventListener('abort', onParent);
  const timer = setTimeout(() => {
    timed = true;
    ac.abort();
  }, ms);
  return {
    signal: ac.signal,
    timedOut: () => timed && !parent.aborted,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParent);
    },
  };
}
