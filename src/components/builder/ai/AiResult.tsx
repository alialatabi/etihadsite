'use client';

import { Check, LoaderCircle, Pencil, RefreshCw, TriangleAlert, Upload } from 'lucide-react';
import { builder } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { fillLtr } from '@/components/fill-ltr';
import { count } from '@/lib/plural';
import { cn } from '@/lib/utils';
import type { BuilderApi } from '../useBuilder';
import { aiErrorMessage } from './ai-logic';
import type { AiDesignApi } from './useAiDesign';

const CHECKER = 'bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px]';

/** The design as it will be cut: on a checkerboard for a custom shape, clipped round for a circle. */
function DesignImage({ src, custom, circle }: { src: string; custom: boolean; circle: boolean }) {
  return (
    <div className={cn('mx-auto flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl border p-3', custom ? CHECKER : 'bg-white')}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
      <img src={src} alt="" className={cn('max-h-full max-w-full object-contain', circle && 'aspect-square rounded-full object-cover')} />
    </div>
  );
}

function PrintedText({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <p className="text-sm">
      <span className="font-medium">{builder.ai.printedText}</span>{' '}
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <bdi>{l}</bdi>
        </span>
      ))}
    </p>
  );
}

function Remaining({ n }: { n: number | null }) {
  if (n === null) return null;
  return <p className="text-sm text-muted-foreground">{fillLtr(builder.ai.remaining, { n, attempts: <>{count(n, builder.ai.attempts)}</> })}</p>;
}

/** The design step when the site designs the sticker: progress, then the result with accept / retry / edit the idea. */
export function AiResult({ b, ai }: { b: BuilderApi; ai: AiDesignApi }) {
  const custom = b.shape === 'custom';
  const circle = b.shape === 'circle';
  const noTriesLeft = ai.remainingToday === 0;

  const editIdea = (
    <Button type="button" variant="ghost" className="h-11 px-4" onClick={ai.editIdea}>
      <Pencil className="size-4" aria-hidden />
      {builder.ai.editIdea}
    </Button>
  );
  const readyDesign = (
    <Button type="button" variant="outline" className="h-11 px-4" onClick={b.chooseUpload}>
      <Upload className="size-4" aria-hidden />
      {builder.ai.readyDesign}
    </Button>
  );

  if (ai.phase === 'generating') {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border bg-card p-6 text-center">
        <LoaderCircle className="size-10 animate-spin text-brand" aria-hidden />
        <p role="status" className="text-base font-medium">
          {builder.ai.generating}
        </p>
      </div>
    );
  }

  if (ai.phase === 'result' && ai.result) {
    return (
      <div className="space-y-4">
        <DesignImage src={ai.result.previewUrl} custom={custom} circle={circle} />
        <PrintedText lines={ai.result.lines} />
        <Remaining n={ai.remainingToday} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            // The first page changed shape while the result waited: this image is not for it.
            disabled={b.decoding || b.shape !== ai.result.madeFor.shape}
            onClick={() => void ai.accept()}
            className="h-12 bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90"
          >
            {b.decoding ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            {builder.ai.accept}
          </Button>
          <Button type="button" variant="outline" className="h-12 px-5" disabled={noTriesLeft || b.decoding} onClick={() => void ai.retry()}>
            <RefreshCw className="size-4" aria-hidden />
            {builder.ai.retry}
          </Button>
          {editIdea}
        </div>
      </div>
    );
  }

  if (ai.phase === 'error' && ai.error) {
    // 'refused' can be an unusable custom result, so another try is offered next to «عدّل الفكرة».
    const canRetry = !ai.off && !noTriesLeft && ai.error !== 'ip_limit' && ai.error !== 'text_too_long' && ai.error !== 'invalid_request';
    return (
      <div className="space-y-4">
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{aiErrorMessage(ai.error)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canRetry && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void ai.retry()}>
              <RefreshCw className="size-4" aria-hidden />
              {builder.ai.retry}
            </Button>
          )}
          {editIdea}
          {readyDesign}
        </div>
      </div>
    );
  }

  // Nothing running: the accepted design (also after a reload), or the way back to the idea.
  return (
    <div className="space-y-4">
      {b.design && <DesignImage src={b.design.previewUrl} custom={custom} circle={circle} />}
      {b.design && ai.acceptedLines && <PrintedText lines={ai.acceptedLines} />}
      <div className="flex flex-wrap items-center gap-3">
        {editIdea}
        {!b.design && readyDesign}
      </div>
    </div>
  );
}
