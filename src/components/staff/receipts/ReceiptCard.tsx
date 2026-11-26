'use client';

import { memo } from 'react';
import { FileDown, FileText, LoaderCircle, RotateCw, Trash2, TriangleAlert } from 'lucide-react';
import { builder, fill, staff } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { btnCls, fieldCls } from '@/components/collage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MAX_SPACING_UM,
  RECEIPT_FORMATS,
  RECEIPT_FORMAT_IDS,
  RECEIPT_GRID,
  receiptSlots,
  spacingFits,
  type ReceiptFormat,
  type ReceiptSpacing,
  type ReceiptSpacingKey,
  type ReceiptTurn,
  type ReceiptWhite,
} from '@/lib/receipts/formats';
import { UM_PER_MM, A4_UM } from '@/lib/units';
import { uploadLimitMb } from '@/lib/upload-limit';
import { cn } from '@/lib/utils';
import { MAX_RECEIPT_FILE_BYTES, type ReceiptCardState, type ReceiptCardView } from './receipt-logic';

interface Props {
  card: ReceiptCardState;
  view: ReceiptCardView;
  onFormat: (id: string, format: ReceiptFormat) => void;
  onTurn: (id: string) => void;
  onWhite: (id: string, white: ReceiptWhite) => void;
  onSpacing: (id: string, key: ReceiptSpacingKey, text: string) => void;
  onSpacingReset: (id: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  /** A download is running: the per-card buttons wait. */
  busy: boolean;
}

const r = staff.receipts;
const WHITES: readonly ReceiptWhite[] = ['top', 'bottom'];
/** µm to mm, rounded to the micrometre so the markup carries no floating-point noise. */
const mm = (um: number) => Math.round(um) / UM_PER_MM;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** "A5" and "15 × 19.5 سم، 2 بالورقة" for one format: on two lines in the list, on one line in the closed picker. */
function FormatLine({ format, inline }: { format: ReceiptFormat; inline?: boolean }) {
  return (
    <span className={inline ? 'flex min-w-0 items-baseline gap-2 text-start' : 'flex min-w-0 flex-col items-start gap-0.5 text-start'}>
      <span className="font-medium">
        <Ltr>{r.formats[format]}</Ltr>
      </span>
      <span className="text-xs text-muted-foreground">{fillLtr(r.formatDetail, { size: r.sizes[format], n: RECEIPT_FORMATS[format].perSheet })}</span>
    </span>
  );
}

/** One millimetre field of the spacing section. The text is the card's own, so text that is not a number stays visible and blocks the download. */
function SpacingField({
  card,
  view,
  field,
  label,
  disabled,
  onSpacing,
}: {
  card: ReceiptCardState;
  view: ReceiptCardView;
  field: ReceiptSpacingKey;
  label: string;
  disabled: boolean;
  onSpacing: Props['onSpacing'];
}) {
  const id = `receipt-sp-${field}-${card.id}`;
  const invalid = view.invalidSpacing.includes(field);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={fieldCls.label}>
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        className={cn(fieldCls.input, 'text-start')}
        value={card.spacingText[field]}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onSpacing(card.id, field, e.target.value)}
      />
      {invalid && (
        <p id={`${id}-error`} className={fieldCls.error}>
          {fillLtr(r.spacing.invalid, { lowMm: 0, highMm: MAX_SPACING_UM / UM_PER_MM })}
        </p>
      )}
    </div>
  );
}

/**
 * The A4 sheet as the PDF will print it: the preview image stretched into every slot and turned
 * by the card's turn about the slot centre (the preview is already upright, so only the card's
 * turn applies). A quarter turn draws the image with its sides swapped first.
 */
function SheetSketch({ format, spacing, turn, previewUrl }: { format: ReceiptFormat; spacing: ReceiptSpacing; turn: ReceiptTurn; previewUrl: string | null }) {
  const swap = turn === 90 || turn === 270;
  // No room: nothing to draw (the slot sizes would be zero or negative).
  const slots = spacingFits(format, spacing) ? receiptSlots(format, spacing) : [];
  return (
    <svg
      viewBox={`0 0 ${mm(A4_UM.widthUm)} ${mm(A4_UM.heightUm)}`}
      className="block h-auto w-full rounded-[2px] bg-white shadow-paper"
      role="img"
      aria-label={r.previewAria}
      preserveAspectRatio="xMidYMid meet"
    >
      {slots.map((s, i) => {
        const x = mm(s.xUm);
        const y = mm(s.yUm);
        const w = mm(s.widthUm);
        const h = mm(s.heightUm);
        const cx = x + w / 2;
        const cy = y + h / 2;
        const iw = swap ? h : w;
        const ih = swap ? w : h;
        return (
          <g key={i} data-receipt-slot={i}>
            {previewUrl && (
              <image
                href={previewUrl}
                x={round3(cx - iw / 2)}
                y={round3(cy - ih / 2)}
                width={iw}
                height={ih}
                preserveAspectRatio="none"
                transform={turn ? `rotate(${turn} ${round3(cx)} ${round3(cy)})` : undefined}
              />
            )}
            <rect x={x} y={y} width={w} height={h} fill="none" stroke="#cbd5e1" strokeWidth={0.4} />
          </g>
        );
      })}
    </svg>
  );
}

/** One receipt design: thumbnail, name, format, turn, the A4 sheet preview and its messages. */
export const ReceiptCard = memo(function ReceiptCard({ card, view, onFormat, onTurn, onWhite, onSpacing, onSpacingReset, onRemove, onDownload, busy }: Props) {
  const msgId = `receipt-msg-${card.id}`;
  const previewUrl = card.design?.previewUrl ?? null;
  const grid = RECEIPT_GRID[card.format];
  const spacingOff = busy || card.status !== 'ready';

  return (
    <li className="paper-card p-4" data-receipt-card={card.id}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: URL preview
                <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
              ) : card.status === 'decoding' ? (
                <LoaderCircle className="size-6 animate-spin text-brand" aria-hidden />
              ) : (
                <FileText className="size-6 text-muted-foreground" aria-hidden />
              )}
            </div>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              <Ltr>{card.file.name}</Ltr>
            </p>
            {view.valid && (
              <Button type="button" variant="outline" size="icon" className={cn(btnCls('outline'), 'w-11 px-0')} disabled={busy} aria-label={fill(staff.downloadOne, { name: card.file.name })} onClick={() => onDownload(card.id)}>
                <FileDown className="size-4" aria-hidden />
              </Button>
            )}
            <Button type="button" variant="outline" size="icon" className={cn(btnCls('outline'), 'w-11 px-0')} aria-label={fill(staff.removeAria, { name: card.file.name })} onClick={() => onRemove(card.id)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`receipt-format-${card.id}`} className={fieldCls.label}>{r.formatLabel}</Label>
            <Select value={card.format} onValueChange={(v) => onFormat(card.id, v as ReceiptFormat)}>
              <SelectTrigger id={`receipt-format-${card.id}`} className={fieldCls.select}>
                <SelectValue>
                  <FormatLine format={card.format} inline />
                </SelectValue>
              </SelectTrigger>
              <SelectContent dir="rtl" alignItemWithTrigger={false}>
                {RECEIPT_FORMAT_IDS.map((f) => (
                  <SelectItem key={f} value={f} className="min-h-11">
                    <FormatLine format={f} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <Button type="button" variant="outline" className={btnCls('outline')} disabled={!card.design} onClick={() => onTurn(card.id)}>
              <RotateCw className="size-4" aria-hidden />
              {r.turn}
            </Button>
            {card.format === 'a6' && (
              <div role="group" aria-label={r.whiteLabel} className="space-y-2">
                <p className={fieldCls.label}>{r.whiteLabel}</p>
                <div className="flex gap-2">
                  {WHITES.map((w) => (
                    <Button
                      key={w}
                      type="button"
                      variant={card.white === w ? 'default' : 'outline'}
                      className={btnCls(card.white === w ? 'ink' : 'outline')}
                      aria-pressed={card.white === w}
                      onClick={() => onWhite(card.id, w)}
                    >
                      {w === 'top' ? r.whiteTop : r.whiteBottom}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {card.design && (
            <fieldset className="space-y-3" data-receipt-spacing={card.id}>
              <legend className={fieldCls.label}>{r.spacing.title}</legend>
              {/* The four PHYSICAL sides of the paper. In RTL the first cell of a row is on the right. */}
              <div className="grid grid-cols-2 gap-3">
                <SpacingField card={card} view={view} field="topUm" label={r.spacing.top} disabled={spacingOff} onSpacing={onSpacing} />
                <SpacingField card={card} view={view} field="bottomUm" label={r.spacing.bottom} disabled={spacingOff} onSpacing={onSpacing} />
                <SpacingField card={card} view={view} field="rightUm" label={r.spacing.right} disabled={spacingOff} onSpacing={onSpacing} />
                <SpacingField card={card} view={view} field="leftUm" label={r.spacing.left} disabled={spacingOff} onSpacing={onSpacing} />
                {grid.cols > 1 && <SpacingField card={card} view={view} field="gapXUm" label={r.spacing.gapX} disabled={spacingOff} onSpacing={onSpacing} />}
                {grid.rows > 1 && (
                  <SpacingField card={card} view={view} field="gapYUm" label={grid.cols > 1 ? r.spacing.gapY : r.spacing.gap} disabled={spacingOff} onSpacing={onSpacing} />
                )}
              </div>
              {card.format === 'a6' && <p className={fieldCls.hint}>{fillLtr(card.white === 'top' ? r.spacing.a6Hint : r.spacing.a6HintBottom, { formatName: r.formats.a6 })}</p>}
              <Button type="button" variant="outline" className={btnCls('outline')} disabled={spacingOff} onClick={() => onSpacingReset(card.id)}>
                {r.spacing.reset}
              </Button>
            </fieldset>
          )}

          <div id={msgId} aria-live="polite" className="space-y-2">
            {view.problem?.kind === 'decode' && (
              <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{fillLtr(builder.upload.errors[view.problem.error], { mb: uploadLimitMb(MAX_RECEIPT_FILE_BYTES) })}</span>
              </p>
            )}
            {view.problem?.kind === 'spacing' && view.problem.reason === 'noRoom' && (
              <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{r.spacing.noRoom}</span>
              </p>
            )}
            {view.multiPage && <p className="rounded-[2px] bg-news px-3 py-2 text-sm text-ink-soft">{r.multiPage}</p>}
            {view.dpi !== null && view.problem?.kind !== 'decode' && <p className="text-sm font-medium">{fillLtr(builder.size.dpiLabel, { dpi: view.dpi })}</p>}
            {view.lowDpi && view.problem?.kind !== 'decode' && (
              <p role="status" className="rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-ink">
                {staff.lowDpi}
              </p>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-44 shrink-0 sm:mx-0 sm:w-44">
          <SheetSketch format={card.format} spacing={card.spacing} turn={card.turn} previewUrl={previewUrl} />
        </div>
      </div>
    </li>
  );
});
