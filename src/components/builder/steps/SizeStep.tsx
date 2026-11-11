'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fillLtr } from '@/components/fill-ltr';
import { safeFormatCm, safeParseCm } from '../safe';
import type { BuilderApi } from '../useBuilder';

function SizeField({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  return (
    <div className="flex-1 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-12 text-center text-lg md:text-lg"
        />
        <span className="shrink-0 text-sm text-muted-foreground">{common.units.cm}</span>
      </div>
    </div>
  );
}

export function SizeStep({ b }: { b: BuilderApi }) {
  const isCircle = b.shape === 'circle';
  const widthBad = b.widthText.trim() !== '' && safeParseCm(b.widthText) === null;
  const heightBad = !isCircle && b.heightText.trim() !== '' && safeParseCm(b.heightText) === null;
  const max = b.maxWidthUm ? safeFormatCm(b.maxWidthUm) : null;

  let error: ReactNode = null;
  if (widthBad || heightBad) error = builder.size.errors.invalid;
  else if (b.outcome && !b.outcome.ok) error = fillLtr(builder.size.errors[b.outcome.reason], { max: max ?? '—' });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {isCircle ? (
          <SizeField id="size-width" label={builder.size.diameter} value={b.widthText} onChange={b.onWidthChange} invalid={widthBad || !!error} describedBy="size-msg" />
        ) : (
          <>
            <SizeField id="size-width" label={builder.size.width} value={b.widthText} onChange={b.onWidthChange} invalid={widthBad || !!error} describedBy="size-msg" />
            <SizeField id="size-height" label={builder.size.height} value={b.heightText} onChange={b.onHeightChange} invalid={heightBad || !!error} describedBy="size-msg" />
          </>
        )}
      </div>

      {!isCircle && <p className="text-sm text-muted-foreground">{builder.size.lockedHint}</p>}
      {max && <p className="text-sm text-muted-foreground">{fillLtr(builder.size.maxHint, { max })}</p>}

      <div id="size-msg" aria-live="polite">
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>

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
