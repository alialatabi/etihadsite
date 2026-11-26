'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { builder } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { safeFormatCm, safeParseCm } from '../safe';
import type { DesignRow } from '../multi-logic';
import type { BuilderApi } from '../useBuilder';
import { SizeInputs, sizeIdsFor } from './SizeFields';

/** What is wrong with one design's size (unreadable number, or this design does not fit), or null. */
function rowError(b: BuilderApi, r: DesignRow): ReactNode {
  const isCircle = b.shape === 'circle';
  const widthBad = r.widthText.trim() !== '' && safeParseCm(r.widthText) === null;
  const heightBad = !isCircle && r.heightText.trim() !== '' && safeParseCm(r.heightText) === null;
  if (widthBad || heightBad) return builder.size.errors.invalid;
  const out = b.multiOutcome;
  if (out && !out.ok && out.designIndex === r.index) {
    return fillLtr(builder.size.errors[out.reason], { max: r.maxWidthUm ? safeFormatCm(r.maxWidthUm) : '—' });
  }
  return null;
}

/** The designs fit one by one but not together (no design is named by the layout). */
function combinedError(b: BuilderApi): ReactNode {
  const out = b.multiOutcome;
  if (!out || out.ok || out.designIndex !== undefined) return null;
  return out.reason === 'too_big_for_page' ? builder.multi.doNotFit : fillLtr(builder.size.errors[out.reason], { max: '—' });
}

/** The size step of a multi-design order: one size row per design, each locked to its own artwork. */
export function MultiSizeStep({ b }: { b: BuilderApi }) {
  const isCircle = b.shape === 'circle';
  const combined = combinedError(b);
  const anyRowError = b.rows.some((r) => rowError(b, r) !== null);

  return (
    <div className="space-y-4">
      {!isCircle && <p className="text-sm text-ink-muted">{builder.size.lockedHint}</p>}
      <p className="text-sm font-medium text-ink">{builder.multi.sizesTitle}</p>
      <ul className="space-y-4">
        {b.rows.map((r) => (
          <DesignSizeRow key={r.id} b={b} r={r} isCircle={isCircle} />
        ))}
      </ul>

      <div id="size-multi-msg" aria-live="polite">
        {combined && (
          <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{combined}</span>
          </p>
        )}
      </div>

      {b.multiLayout && !combined && !anyRowError && (
        <p className="sr-only" aria-live="polite">
          {fillLtr(builder.size.countHint, { count: b.multiLayout.countPerSheet })}
        </p>
      )}
    </div>
  );
}

function DesignSizeRow({ b, r, isCircle }: { b: BuilderApi; r: DesignRow; isCircle: boolean }) {
  const n = r.index + 1;
  const ids = sizeIdsFor(n);
  const error = rowError(b, r);
  const max = r.maxWidthUm ? safeFormatCm(r.maxWidthUm) : null;
  const onWidth = r.index === 0 ? b.onWidthChange : (v: string) => b.onExtraWidthChange(r.id, v);
  const onHeight = r.index === 0 ? b.onHeightChange : (v: string) => b.onExtraHeightChange(r.id, v);

  return (
    <li className="paper-card space-y-3 p-4">
      <div className="flex items-center gap-3">
        {r.design ? (
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
            <img src={r.design.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 id={`size-title-${n}`} className="font-heading text-base font-bold text-ink">{fillLtr(builder.multi.designN, { n })}</h3>
          {r.design ? (
            <Ltr className="block truncate text-xs text-ink-muted">{r.design.file.name}</Ltr>
          ) : (
            <p className="text-xs text-ink-muted">{builder.multi.waitingDesign}</p>
          )}
        </div>
      </div>

      {r.design && (
        <>
          <SizeInputs
            ids={ids}
            labelledBy={`size-title-${n}`}
            isCircle={isCircle}
            widthText={r.widthText}
            heightText={r.heightText}
            onWidth={onWidth}
            onHeight={onHeight}
            invalid={!!error}
          />
          {max && <p className="text-sm text-ink-muted">{fillLtr(builder.size.maxHint, { max })}</p>}
          <div id={ids.msg} aria-live="polite">
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{error}</span>
              </p>
            )}
          </div>
          {r.dpi !== null && !error && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{fillLtr(builder.size.dpiLabel, { dpi: r.dpi })}</p>
              {r.dpiState === 'warn' && (
                <p role="status" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
                  {builder.size.dpiWarn}
                </p>
              )}
              {r.dpiState === 'block' && (
                <p role="alert" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
                  {builder.size.dpiBlock}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}
