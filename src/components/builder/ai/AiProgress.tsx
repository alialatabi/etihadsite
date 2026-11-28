'use client';

import { useEffect, useState } from 'react';
import { builder } from '@/content/ar';
import { cn } from '@/lib/utils';
import { progressAt, startProgressClock, type ProgressKind } from './progress-logic';

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
export function AiProgressView({
  kind,
  elapsedMs,
  extendSteps = 0,
  className,
}: {
  kind: ProgressKind;
  elapsedMs: number;
  /** Extension calls of a long rectangle (expectedExtendSteps): the estimate then expects a longer wait. */
  extendSteps?: number;
  className?: string;
}) {
  const { percent, stageIndex, slow } = progressAt(elapsedMs, kind, extendSteps);
  const stage = slow ? builder.ai.progress.slow : builder.ai.progress[kind][stageIndex];
  return (
    <div aria-live="off" className={cn('w-full max-w-sm space-y-2', className)}>
      <p aria-live="polite" aria-atomic="true" className="text-sm font-medium text-ink">
        {stage}
      </p>
      <div
        role="progressbar"
        aria-label={builder.ai.progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(percent)}
        className="flex h-3 w-full justify-start overflow-hidden rounded-[2px] border border-ink/25 bg-news"
      >
        <div
          className="h-full shrink-0 rounded-[2px] bg-brand transition-[width] duration-500 ease-linear motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      {kind === 'image' && <p className="text-[14px] leading-[1.4] text-ink-muted">{builder.ai.progress.wait}</p>}
    </div>
  );
}

/** Ticks from `startedAt` (default: when it mounts), starting with one tick at once; the timers stop on unmount. */
export function AiProgress({
  kind,
  startedAt,
  extendSteps,
  className,
}: {
  kind: ProgressKind;
  startedAt?: number;
  extendSteps?: number;
  className?: string;
}) {
  // Starts from the clock, not 0: a remounted bar paints its real place on the first frame. It only mounts on the client, after a click.
  const [elapsedMs, setElapsedMs] = useState(() => (startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt)));
  useEffect(() => startProgressClock(startedAt ?? Date.now(), setElapsedMs), [startedAt]);
  return <AiProgressView kind={kind} elapsedMs={elapsedMs} extendSteps={extendSteps} className={className} />;
}
