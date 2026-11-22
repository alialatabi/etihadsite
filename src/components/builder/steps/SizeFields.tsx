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

/** DOM ids of one design's size inputs and of the message that describes them. */
export interface SizeIds {
  width: string;
  height: string;
  msg: string;
}

/** Design 1's ids: the ones the page has always had. */
export const FIRST_SIZE_IDS: SizeIds = { width: 'size-width', height: 'size-height', msg: 'size-msg' };

/** The ids of design `n` (1-based) of a multi-design order: design 1 keeps its own, the others get `-n`. */
export const sizeIdsFor = (n: number): SizeIds =>
  n <= 1 ? FIRST_SIZE_IDS : { width: `size-width-${n}`, height: `size-height-${n}`, msg: `size-msg-${n}` };

/** The width and height boxes of one design (a circle has only the diameter). */
export function SizeInputs({
  ids,
  isCircle,
  widthText,
  heightText,
  onWidth,
  onHeight,
  invalid,
}: {
  ids: SizeIds;
  isCircle: boolean;
  widthText: string;
  heightText: string;
  onWidth: (v: string) => void;
  onHeight: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {isCircle ? (
        <SizeField id={ids.width} label={builder.size.diameter} value={widthText} onChange={onWidth} invalid={invalid} describedBy={ids.msg} inputClassName="h-12 text-center text-lg md:text-lg" />
      ) : (
        <>
          <SizeField id={ids.width} label={builder.size.width} value={widthText} onChange={onWidth} invalid={invalid} describedBy={ids.msg} inputClassName="h-12 text-center text-lg md:text-lg" />
          <SizeField id={ids.height} label={builder.size.height} value={heightText} onChange={onHeight} invalid={invalid} describedBy={ids.msg} inputClassName="h-12 text-center text-lg md:text-lg" />
        </>
      )}
    </div>
  );
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
      <SizeInputs
        ids={FIRST_SIZE_IDS}
        isCircle={isCircle}
        widthText={b.widthText}
        heightText={b.heightText}
        onWidth={b.onWidthChange}
        onHeight={b.onHeightChange}
        invalid={!!error}
      />

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
