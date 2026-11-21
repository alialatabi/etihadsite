import { describe, expect, it, vi } from 'vitest';
import {
  QueueAbortError,
  clampDpr,
  createJobSignal,
  createSerialQueue,
  previewCanvasWidth,
} from '@/components/admin/sheet-preview-logic';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('clampDpr / previewCanvasWidth', () => {
  it('clamps to 1..2 and survives junk', () => {
    expect(clampDpr(undefined)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);
    expect(clampDpr(0.5)).toBe(1);
    expect(clampDpr(1.5)).toBe(1.5);
    expect(clampDpr(3)).toBe(2);
  });
  it('sizes thumb and large canvases', () => {
    expect(previewCanvasWidth('thumb', 1)).toBe(120);
    expect(previewCanvasWidth('thumb', 3)).toBe(240);
    expect(previewCanvasWidth('large', 2)).toBe(1600);
  });
});

describe('createSerialQueue', () => {
  it('never runs two jobs at once and keeps order', async () => {
    const run = createSerialQueue();
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const job = (n: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      order.push(n);
      active--;
      return n;
    };
    const results = await Promise.all([run(job(1)), run(job(2)), run(job(3))]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
  });

  it('a failing job does not block the next one', async () => {
    const run = createSerialQueue();
    const a = run(async () => {
      throw new Error('boom');
    });
    const b = run(async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });

  it('skips a job aborted before its turn without running it', async () => {
    const run = createSerialQueue();
    const ac = new AbortController();
    let ran = false;
    const first = run(async () => {
      await tick();
      return 1;
    });
    const skipped = run(async () => {
      ran = true;
      return 2;
    }, ac.signal);
    ac.abort();
    const last = run(async () => 3);
    await expect(first).resolves.toBe(1);
    await expect(skipped).rejects.toBeInstanceOf(QueueAbortError);
    await expect(last).resolves.toBe(3);
    expect(ran).toBe(false);
  });
});

describe('createJobSignal', () => {
  it('aborts after the time limit', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const job = createJobSignal(parent.signal, 1000);
      expect(job.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(job.signal.aborted).toBe(true);
      job.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it('follows the parent, and dispose stops the timer', () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const job = createJobSignal(parent.signal, 1000);
      parent.abort();
      expect(job.signal.aborted).toBe(true);
      job.dispose();
      const parent2 = new AbortController();
      const job2 = createJobSignal(parent2.signal, 1000);
      job2.dispose();
      vi.advanceTimersByTime(5000);
      expect(job2.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
