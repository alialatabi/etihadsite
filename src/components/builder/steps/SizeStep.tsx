'use client';

import { TriangleAlert } from 'lucide-react';
import { builder } from '@/content/ar';
import { fillLtr } from '@/components/fill-ltr';
import { TextWarningNote } from '../ai/TextWarningNote';
import { textWarning } from '../ai/ai-logic';
import { acceptedAiLines, aiShrinkWarning } from '../logic';
import { safeFormatCm } from '../safe';
import type { BuilderApi } from '../useBuilder';
import { MultiSizeStep } from './MultiSizeStep';
import { SizeFields, sizeError } from './SizeFields';

export function SizeStep({ b }: { b: BuilderApi }) {
  // Several designs: one size row per design (the single-design page below is untouched).
  if (b.multiActive) return <MultiSizeStep b={b} />;
  const isCircle = b.shape === 'circle';
  const max = b.maxWidthUm ? safeFormatCm(b.maxWidthUm) : null;
  const error = sizeError(b);
  // Too much text for this size: a warning for the lines of the accepted AI design (not the review box, which may have
  // been edited since). It replaces the shrink warning, so only one of them shows.
  const acceptedLines = acceptedAiLines({ mode: b.mode, aiLines: b.aiLines, aiFileId: b.aiFileId, fileId: b.fileId });
  const textWarn = acceptedLines && !error ? textWarning(acceptedLines, b.shape, b.spec, b.maxWidthUm) : null;
  const shrunk = !textWarn && aiShrinkWarning(b.aiSizeUm, b.spec);

  return (
    <div className="space-y-4">
      <SizeFields b={b}>
        {!isCircle && <p className="text-sm text-ink-muted">{builder.size.lockedHint}</p>}
        {max && <p className="text-sm text-ink-muted">{fillLtr(builder.size.maxHint, { max })}</p>}
      </SizeFields>

      <TextWarningNote warning={textWarn} />

      {shrunk && !error && (
        <p role="status" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{builder.ai.shrinkWarning}</span>
        </p>
      )}

      {b.dpi !== null && !error && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">{fillLtr(builder.size.dpiLabel, { dpi: b.dpi })}</p>
          {b.dpiState === 'warn' && (
            <p role="status" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
              {builder.size.dpiWarn}
            </p>
          )}
          {b.dpiState === 'block' && (
            <p role="alert" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
              {builder.size.dpiBlock}
            </p>
          )}
        </div>
      )}
      {b.layout && !error && (
        <p className="sr-only" aria-live="polite">
          {fillLtr(builder.size.countHint, { count: b.layout.countPerSheet })}
        </p>
      )}
    </div>
  );
}
