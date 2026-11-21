'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { builder } from '@/content/ar';
import { fillLtr } from '@/components/fill-ltr';
import { safeFormatCm, safeParseCm } from '../safe';
import { SizeField } from '../SizeField';
import type { BuilderApi } from '../useBuilder';

/** What is wrong with the typed size (unreadable number, does not fit the sheet), or null. */
export function sizeError(b: BuilderApi): ReactNode {
  const isCircle = b.shape === 'circle';
  const widthBad = b.widthText.trim() !== '' && safeParseCm(b.widthText) === null;
  const heightBad = !isCircle && b.heightText.trim() !== '' && safeParseCm(b.heightText) === null;
  const max = b.maxWidthUm ? safeFormatCm(b.maxWidthUm) : null;
  if (widthBad || heightBad) return builder.size.errors.invalid;
  if (b.outcome && !b.outcome.ok) return fillLtr(builder.size.errors[b.outcome.reason], { max: max ?? '—' });
  return null;
}

/**
 * The size inputs (diameter, or width × height) and their error message, with `children` (hints) between them.
 * Used on the first page and on the arrangement step.
 */
export function SizeFields({ b, children }: { b: BuilderApi; children?: ReactNode }) {
  const isCircle = b.shape === 'circle';
  const error = sizeError(b);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row">
        {isCircle ? (
          <SizeField id="size-width" label={builder.size.diameter} value={b.widthText} onChange={b.onWidthChange} invalid={!!error} describedBy="size-msg" inputClassName="h-12 text-center text-lg md:text-lg" />
        ) : (
          <>
            <SizeField id="size-width" label={builder.size.width} value={b.widthText} onChange={b.onWidthChange} invalid={!!error} describedBy="size-msg" inputClassName="h-12 text-center text-lg md:text-lg" />
            <SizeField id="size-height" label={builder.size.height} value={b.heightText} onChange={b.onHeightChange} invalid={!!error} describedBy="size-msg" inputClassName="h-12 text-center text-lg md:text-lg" />
          </>
        )}
      </div>

      {children}

      <div id="size-msg" aria-live="polite">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>
    </>
  );
}
