import { afterEach, describe, expect, it, vi } from 'vitest';
import { builder } from '@/content/ar';
import {
  PROGRESS_CAP,
  PROGRESS_EXTEND_STEP_MS,
  PROGRESS_STAGE_COUNT,
  PROGRESS_STAGE_STARTS_MS,
  PROGRESS_TICK_MS,
  progressAt,
  startProgressClock,
  type ProgressKind,
} from '@/components/builder/ai/progress-logic';

const KINDS: ProgressKind[] = ['brief', 'image'];
/** The routes allow 60 s (brief) and 300 s (generate: a long sticker is painted in several calls). */
const RANGE_MS: Record<ProgressKind, number> = { brief: 60_000, image: 300_000 };

describe('progressAt', () => {
  it('starts at 0 on the first stage, not slow', () => {
    for (const k of KINDS) expect(progressAt(0, k)).toEqual({ percent: 0, stageIndex: 0, slow: false });
  });

  it('is strictly increasing across the route time limits', () => {
    for (const k of KINDS) {
      let prev = -1;
      for (let t = 0; t <= RANGE_MS[k]; t += PROGRESS_TICK_MS) {
        const { percent } = progressAt(t, k);
        expect(percent).toBeGreaterThan(prev);
        prev = percent;
      }
    }
  });

  it('stays under 95 (also rounded down) for any elapsed time', () => {
    const samples = [0, 1, 500, 3_000, 30_000, 60_000, 120_000, 1e6, 1e9, Number.MAX_SAFE_INTEGER, Infinity];
    for (const k of KINDS) {
      for (const t of samples) {
        const { percent } = progressAt(t, k);
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThan(95);
        expect(Math.floor(percent)).toBeLessThanOrEqual(94);
      }
    }
  });

  it('moves fast first, then slows down', () => {
    expect(progressAt(3_000, 'brief').percent).toBeGreaterThan(45);
    expect(progressAt(8_000, 'image').percent).toBeGreaterThan(15);
    const at30 = progressAt(30_000, 'image').percent;
    expect(at30).toBeGreaterThan(55);
    expect(at30).toBeLessThan(65);
    // the second half of the wait gains less than the first
    expect(progressAt(60_000, 'image').percent - at30).toBeLessThan(at30);
  });

  it('treats negative, NaN and -Infinity as the start', () => {
    for (const k of KINDS) {
      for (const t of [-1000, NaN, -Infinity]) expect(progressAt(t, k)).toEqual({ percent: 0, stageIndex: 0, slow: false });
    }
  });

  it('walks the brief stages at 0 / 3 s', () => {
    expect(progressAt(2_999, 'brief').stageIndex).toBe(0);
    expect(progressAt(3_000, 'brief').stageIndex).toBe(1);
    expect(progressAt(59_000, 'brief').stageIndex).toBe(1);
  });

  it('walks the image stages at 0 / 8 s / 25 s / 45 s', () => {
    const idx = (t: number) => progressAt(t, 'image').stageIndex;
    expect(idx(7_999)).toBe(0);
    expect(idx(8_000)).toBe(1);
    expect(idx(24_999)).toBe(1);
    expect(idx(25_000)).toBe(2);
    expect(idx(44_999)).toBe(2);
    expect(idx(45_000)).toBe(3);
    expect(idx(119_000)).toBe(3);
  });

  it('turns slow on at 15 s (brief) and 70 s (image) and stays on', () => {
    expect(progressAt(14_999, 'brief').slow).toBe(false);
    expect(progressAt(15_000, 'brief').slow).toBe(true);
    expect(progressAt(60_000, 'brief').slow).toBe(true);
    expect(progressAt(69_999, 'image').slow).toBe(false);
    expect(progressAt(70_000, 'image').slow).toBe(true);
    expect(progressAt(120_000, 'image').slow).toBe(true);
  });

  it('has as many stages as the copy has texts', () => {
    expect(PROGRESS_STAGE_COUNT.brief).toBe(builder.ai.progress.brief.length);
    expect(PROGRESS_STAGE_COUNT.image).toBe(builder.ai.progress.image.length);
    for (const k of KINDS) {
      const starts = PROGRESS_STAGE_STARTS_MS[k];
      expect(starts.length).toBe(PROGRESS_STAGE_COUNT[k]);
      expect(starts[0]).toBe(0);
      for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
      for (let t = 0; t <= RANGE_MS[k]; t += PROGRESS_TICK_MS) {
        expect(progressAt(t, k).stageIndex).toBeLessThanOrEqual(PROGRESS_STAGE_COUNT[k] - 1);
      }
    }
  });

  it('pins the cap and the tick', () => {
    expect(PROGRESS_CAP).toBe(95);
    expect(PROGRESS_TICK_MS).toBe(500);
  });
});

describe('progressAt with extension calls (a long rectangle)', () => {
  it('the default and 0 steps are the plain curve', () => {
    for (const t of [0, 5_000, 30_000, 70_000, 200_000]) {
      expect(progressAt(t, 'image', 0)).toEqual(progressAt(t, 'image'));
    }
  });

  it('expects a longer wait: the bar is slower, each step delays the later stages and the slow text', () => {
    const plain = progressAt(30_000, 'image').percent;
    const long = progressAt(30_000, 'image', 3).percent;
    expect(long).toBeLessThan(plain - 10);
    expect(long).toBeGreaterThan(0);
    const extra = 3 * PROGRESS_EXTEND_STEP_MS;
    expect(progressAt(PROGRESS_STAGE_STARTS_MS.image[1], 'image', 3).stageIndex).toBe(1);
    expect(progressAt(PROGRESS_STAGE_STARTS_MS.image[2] + extra - 1, 'image', 3).stageIndex).toBe(1);
    expect(progressAt(PROGRESS_STAGE_STARTS_MS.image[2] + extra, 'image', 3).stageIndex).toBe(2);
    expect(progressAt(69_999 + 2 * extra, 'image', 3).slow).toBe(false);
    expect(progressAt(70_000 + 2 * extra, 'image', 3).slow).toBe(true);
  });

  it('still never reaches the cap and only changes the image kind', () => {
    for (const steps of [1, 6, 12]) {
      expect(progressAt(Infinity, 'image', steps).percent).toBeLessThan(95);
      expect(progressAt(300_000, 'image', steps).percent).toBeLessThan(95);
    }
    expect(progressAt(10_000, 'brief', 6)).toEqual(progressAt(10_000, 'brief'));
  });
});

describe('startProgressClock', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the real elapsed time at once for a start in the past (a remount keeps its place), then every tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const seen: number[] = [];
    const stop = startProgressClock(100_000 - 30_000, (ms) => seen.push(ms));
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(seen).toEqual([30_000]);
    expect(progressAt(seen[0], 'image').stageIndex).toBe(2);
    expect(progressAt(seen[0], 'image').percent).toBeGreaterThan(0);
    vi.advanceTimersByTime(PROGRESS_TICK_MS);
    expect(seen).toEqual([30_000, 30_000 + PROGRESS_TICK_MS]);
    stop();
  });

  it('stops on cleanup, also before the first tick', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    startProgressClock(Date.now(), (ms) => seen.push(ms))();
    vi.advanceTimersByTime(5_000);
    expect(seen).toEqual([]);
  });
});
