'use client';

import { memo } from 'react';
import { FileDown, FileText, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import { builder, common, fill, staff } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { fillLtr } from '@/components/fill-ltr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SheetPreview } from '@/components/builder/SheetPreview';
import { safeFormatCm } from '@/components/builder/safe';
import { uploadLimitMb } from '@/lib/upload-limit';
import { MAX_STAFF_FILE_BYTES, STAFF_SHAPES, type StaffCardState, type StaffCardView, type StaffProblem, type StaffShape } from './staff-logic';

interface Props {
  card: StaffCardState;
  view: StaffCardView;
  onShape: (id: string, shape: StaffShape) => void;
  onWidth: (id: string, text: string) => void;
  onHeight: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onDownload: (id: string) => void;
  /** A download is running: the per-card buttons wait. */
  busy: boolean;
}

function problemText(p: StaffProblem, maxWidthUm: number | null) {
  if (p.kind === 'decode') return fillLtr(builder.upload.errors[p.error], { mb: uploadLimitMb(MAX_STAFF_FILE_BYTES) });
  return fillLtr(builder.size.errors[p.reason], { max: maxWidthUm ? safeFormatCm(maxWidthUm) : '—' });
}

function SizeField({ id, label, value, onChange, invalid, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; invalid: boolean; describedBy: string }) {
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
          className="h-11 text-center text-base md:text-base"
        />
        <span className="shrink-0 text-sm text-muted-foreground">{common.units.cm}</span>
      </div>
    </div>
  );
}

/** One design: thumbnail, name, shape, size, the sheet preview and its messages. */
export const StaffCard = memo(function StaffCard({ card, view, onShape, onWidth, onHeight, onRemove, onDownload, busy }: Props) {
  const isCircle = card.shape === 'circle';
  const sizeProblem = view.problem?.kind === 'size';
  const msgId = `staff-msg-${card.id}`;
  const previewUrl = card.design?.previewUrl ?? null;

  return (
    <li className="rounded-2xl border bg-card p-4" data-card={card.id}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
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
              <Button type="button" variant="outline" size="icon" className="size-11" disabled={busy} aria-label={fill(staff.downloadOne, { name: card.file.name })} onClick={() => onDownload(card.id)}>
                <FileDown className="size-4" aria-hidden />
              </Button>
            )}
            <Button type="button" variant="outline" size="icon" className="size-11" aria-label={fill(staff.removeAria, { name: card.file.name })} onClick={() => onRemove(card.id)}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`staff-shape-${card.id}`}>{staff.shapeLabel}</Label>
            <Select value={card.shape} onValueChange={(v) => onShape(card.id, v as StaffShape)}>
              <SelectTrigger id={`staff-shape-${card.id}`} className="w-full data-[size=default]:h-11">
                <SelectValue>{staff.shapes[card.shape]}</SelectValue>
              </SelectTrigger>
              <SelectContent dir="rtl" alignItemWithTrigger={false}>
                {STAFF_SHAPES.map((s) => (
                  <SelectItem key={s} value={s} className="min-h-11">
                    {staff.shapes[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            {isCircle ? (
              <SizeField id={`staff-w-${card.id}`} label={builder.size.diameter} value={card.widthText} onChange={(t) => onWidth(card.id, t)} invalid={sizeProblem} describedBy={msgId} />
            ) : (
              <>
                <SizeField id={`staff-w-${card.id}`} label={builder.size.width} value={card.widthText} onChange={(t) => onWidth(card.id, t)} invalid={sizeProblem} describedBy={msgId} />
                <SizeField id={`staff-h-${card.id}`} label={builder.size.height} value={card.heightText} onChange={(t) => onHeight(card.id, t)} invalid={sizeProblem} describedBy={msgId} />
              </>
            )}
          </div>

          <div id={msgId} aria-live="polite" className="space-y-2">
            {view.problem && (
              <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{problemText(view.problem, view.maxWidthUm)}</span>
              </p>
            )}
            {view.dpi !== null && !view.problem && (
              <p className="text-sm font-medium">{fillLtr(builder.size.dpiLabel, { dpi: view.dpi })}</p>
            )}
            {view.lowDpi && !view.problem && (
              <p role="status" className="rounded-xl border border-brand/50 bg-brand/10 p-3 text-sm">
                {staff.lowDpi}
              </p>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-44 shrink-0 sm:mx-0 sm:w-44">
          <SheetPreview layout={view.layout} previewUrl={previewUrl} />
        </div>
      </div>
    </li>
  );
});
