'use client';

import { useEffect, useState } from 'react';
import { builder } from '@/content/ar';
import { cn } from '@/lib/utils';
import { PROGRESS_TICK_MS, progressAt, type ProgressKind } from './progress-logic';

/**
 * The estimated progress of one AI request (R7): a stage text announced politely only when the stage changes,
 * and a bar whose value is not announced.
 *
 * Why the ticks do not spam an outer live region (AiResult's): each tick React patches only two attributes (the
 * inline width and aria-valuenow), and attribute changes are not live updates under the default aria-relevant.
 * As belt and braces the root carries aria-live="off", so nothing in the bar's subtree belongs to an outer
 * polite region. The stage text is its own polite region (StartStep and the staff page have no outer one); its
 * text node changes only when the stage string changes, so each stage is announced once.
 */
export function AiProgressView({ kind, elapsedMs, className }: { kind: ProgressKind; elapsedMs: number; className?: string }) {
  const { percent, stageIndex, slow } = progressAt(elapsedMs, kind);
  const stage = slow ? builder.ai.progress.slow : builder.ai.progress[kind][stageIndex];
  return (
    <div aria-live="off" className={cn('w-full max-w-sm space-y-2', className)}>
      <p aria-live="polite" aria-atomic="true" className="text-sm font-medium">
        {stage}
      </p>
      <div
        role="progressbar"
        aria-label={builder.ai.progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent)}
        className="flex h-2 w-full justify-start overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full shrink-0 rounded-full bg-brand transition-[width] duration-500 ease-linear motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      {kind === 'image' && <p className="text-xs text-muted-foreground">{builder.ai.progress.wait}</p>}
    </div>
  );
}

/** Ticks every PROGRESS_TICK_MS from `startedAt` (default: when it mounts); the timer stops on unmount. */
export function AiProgress({ kind, startedAt, className }: { kind: ProgressKind; startedAt?: number; className?: string }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const start = startedAt ?? Date.now();
    // Elapsed is read from the clock, not counted in ticks: background tabs throttle intervals.
    const id = window.setInterval(() => setElapsedMs(Date.now() - start), PROGRESS_TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return <AiProgressView kind={kind} elapsedMs={elapsedMs} className={className} />;
}
