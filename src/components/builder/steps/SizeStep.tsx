'use client';

import { TriangleAlert } from 'lucide-react';
import { builder } from '@/content/ar';
import { fillLtr } from '@/components/fill-ltr';
import { aiShrinkWarning } from '../logic';
import { safeFormatCm } from '../safe';
import type { BuilderApi } from '../useBuilder';
import { SizeFields, sizeError } from './SizeFields';

export function SizeStep({ b }: { b: BuilderApi }) {
  const isCircle = b.shape === 'circle';
  const max = b.maxWidthUm ? safeFormatCm(b.maxWidthUm) : null;
  const error = sizeError(b);
  const shrunk = aiShrinkWarning(b.aiSizeUm, b.spec);

  return (
    <div className="space-y-4">
      <SizeFields b={b}>
        {!isCircle && <p className="text-sm text-muted-foreground">{builder.size.lockedHint}</p>}
        {max && <p className="text-sm text-muted-foreground">{fillLtr(builder.size.maxHint, { max })}</p>}
      </SizeFields>

      {shrunk && !error && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{builder.ai.shrinkWarning}</span>
        </p>
      )}

      {b.dpi !== null && !error && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{fillLtr(builder.size.dpiLabel, { dpi: b.dpi })}</p>
          {b.dpiState === 'warn' && (
            <p role="status" className="rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
              {builder.size.dpiWarn}
            </p>
          )}
          {b.dpiState === 'block' && (
            <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
