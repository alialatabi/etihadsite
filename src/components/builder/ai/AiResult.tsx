'use client';

import { useEffect, useRef } from 'react';
import { Check, LoaderCircle, Pencil, RefreshCw, TriangleAlert, Upload } from 'lucide-react';
import { builder } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { fillLtr } from '@/components/fill-ltr';
import { count } from '@/lib/plural';
import { uploadLimitMb } from '@/lib/upload-limit';
import { cn } from '@/lib/utils';
import { acceptedAiLines } from '../logic';
import type { BuilderApi } from '../useBuilder';
import { aiErrorMessage, canRetryAi, maxWidthAtSize, resultAcceptedSpec, resultDpiStatus, resultShown, textWarning } from './ai-logic';
import { AiProgress } from './AiProgress';
import { TextWarningNote } from './TextWarningNote';
import type { AiDesignApi } from './useAiDesign';

const CHECKER = 'bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px]';

/** The design as it will be cut: on a checkerboard for a custom shape, clipped round for a circle. */
function DesignImage({ src, custom, circle }: { src: string; custom: boolean; circle: boolean }) {
  return (
    <div className={cn('mx-auto flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl border p-3', custom ? CHECKER : 'bg-white')}>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
      <img src={src} alt={builder.ai.resultAlt} className={cn('max-h-full max-w-full object-contain', circle && 'aspect-square rounded-full object-cover')} />
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

/**
 * The design step when the site designs the sticker: progress, then the result with accept / retry / edit the idea.
 * One polite live region, so the progress, the result and an error are announced as they replace each other.
 */
export function AiResult({ b, ai }: { b: BuilderApi; ai: AiDesignApi }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // «جرّب مرة ثانية» and «أكمل بهذا» unmount the focused button when the phase changes, which would
  // drop keyboard focus on <body>. Put it on this region then, but only when it really was lost (never
  // steal it from a field the customer moved to) and not on first paint (pattern: Builder.tsx step heading).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) regionRef.current?.focus({ preventScroll: true });
  }, [ai.phase]);

  return (
    <div ref={regionRef} tabIndex={-1} className="outline-none" aria-live="polite">
      <AiResultBody b={b} ai={ai} />
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      <TriangleAlert className="size-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function AiResultBody({ b, ai }: { b: BuilderApi; ai: AiDesignApi }) {
  const custom = b.shape === 'custom';
  const circle = b.shape === 'circle';
  // 'refused' can be an unusable custom result, so another try is offered next to «عدّل الفكرة».
  const canRetry = canRetryAi({ off: ai.off, remainingToday: ai.remainingToday, phase: ai.phase, error: ai.error });
  // Only a failure of the try just made is shown (after «عدّل الفكرة» an old message would sit on a good design).
  const acceptedLines = acceptedAiLines({ mode: b.mode, aiLines: b.aiLines ?? null, aiFileId: b.aiFileId ?? null, fileId: b.fileId ?? null });
  const errorBox = ai.phase === 'error' && ai.error ? <ErrorBox>{aiErrorMessage(ai.error)}</ErrorBox> : null;

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
        <LoaderCircle className="size-6 animate-spin text-brand" aria-hidden />
        <p className="text-base font-medium">{builder.ai.generating}</p>
        <AiProgress kind="image" />
      </div>
    );
  }

  // The kept (paid) result: also after a failed retry (the error above it) and after «عدّل الفكرة».
  if (ai.result && resultShown(ai.phase, true)) {
    const dpi = resultDpiStatus(ai.result, b.settings.quality);
    // The text against the size the design will have once accepted (the size the arrangement step starts from).
    const accepted = resultAcceptedSpec(ai.result);
    const textWarn = textWarning(ai.result.lines, accepted?.shape ?? null, accepted, () => maxWidthAtSize(accepted?.shape ?? null, b.corners, accepted, b.settings.layout));
    return (
      <div className="space-y-4">
        {errorBox}
        <DesignImage src={ai.result.previewUrl} custom={custom} circle={circle} />
        <PrintedText lines={ai.result.lines} />
        <TextWarningNote warning={textWarn} />
        {dpi === 'warn' && (
          <p role="status" className="rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
            {builder.size.dpiWarn}
          </p>
        )}
        {dpi === 'block' && (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {builder.size.dpiBlock}
          </p>
        )}
        <Remaining n={ai.remainingToday} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            // The first page changed shape while the result waited: this image is not for it.
            disabled={b.decoding || b.shape !== ai.result.madeFor.shape || dpi === 'block'}
            onClick={() => void ai.accept()}
            className="h-12 bg-brand px-6 text-base font-bold text-brand-foreground hover:bg-brand/90"
          >
            {b.decoding ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
            {builder.ai.accept}
          </Button>
          <Button type="button" variant="outline" className="h-12 px-5" disabled={!canRetry || b.decoding} onClick={() => void ai.retry()}>
            <RefreshCw className="size-4" aria-hidden />
            {builder.ai.retry}
          </Button>
          {editIdea}
          {errorBox && readyDesign}
        </div>
      </div>
    );
  }

  if (ai.phase === 'error' && ai.error) {
    return (
      <div className="space-y-4">
        {errorBox}
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
      {/* A shape change made the accepted design unusable (e.g. an opaque PNG for a custom die-cut). */}
      {b.designError && (
        <ErrorBox>{fillLtr(builder.upload.errors[b.designError], { mb: uploadLimitMb(b.settings.maxUploadBytes) })}</ErrorBox>
      )}
      {b.design && <DesignImage src={b.design.previewUrl} custom={custom} circle={circle} />}
      {b.design && acceptedLines && <PrintedText lines={acceptedLines} />}
      {b.design && <TextWarningNote warning={textWarning(acceptedLines ?? [], b.shape, b.spec, b.maxWidthUm)} />}
      <div className="flex flex-wrap items-center gap-3">
        {editIdea}
        {!b.design && readyDesign}
      </div>
    </div>
  );
}
