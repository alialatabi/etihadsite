'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudUpload, FileText, LoaderCircle, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { ACCEPTED_EXTENSIONS, MAX_DESIGNS } from '@/config/defaults';
import { builder, common, fill } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fillLtr } from '@/components/fill-ltr';
import { cn } from '@/lib/utils';
import { uploadLimitMb } from '@/lib/upload-limit';
import { AiResult } from '../ai/AiResult';
import type { AiDesignApi } from '../ai/useAiDesign';
import { needsCropNotice, pdfPrefillUm } from '../logic';
import { safeFormatCm } from '../safe';
import type { DesignRow } from '../multi-logic';
import type { BuilderApi } from '../useBuilder';

/** The design step: the AI result when the site designs the sticker, else the upload (unchanged). */
export function DesignStep({ b, ai }: { b: BuilderApi; ai: AiDesignApi }) {
  if (b.mode === 'ai') return <AiResult b={b} ai={ai} />;
  return <UploadDesign b={b} />;
}

function UploadDesign({ b }: { b: BuilderApi }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const wasDecoding = useRef(false);
  const prevCount = useRef(b.designCount);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  /** Which design the «غيّر الملف» input of the design cards is for (0 = design 1). */
  const replaceIndex = useRef(0);
  const [dragging, setDragging] = useState(false);
  // Files over the cap of a multi-design pick were ignored: the customer is told.
  const [capNotice, setCapNotice] = useState(false);
  const { design, decoding, designError, shape } = b;

  const pick = (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    if (b.multi) {
      setCapNotice(b.addFiles(list) > 0);
      return;
    }
    void b.onFile(list[0]);
  };
  const replaceDesign = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setCapNotice(false);
    if (replaceIndex.current === 0) void b.onFile(f);
    else {
      const row = b.rows[replaceIndex.current];
      if (row) b.replaceExtra(row.id, f);
    }
  };
  const openReplace = (index: number) => {
    replaceIndex.current = index;
    replaceInputRef.current?.click();
  };

  // The control that had focus is disabled (then removed) while the file is read, or removed with its design card,
  // so focus falls to <body>: when that happens and nothing else has focus, put it back on the control that now
  // stands in its place («إضافة تصميم» in a multi-design order, else the replace or upload button).
  const multi = b.multi;
  const designCount = b.designCount;
  useEffect(() => {
    const done = wasDecoding.current && !decoding;
    const removed = designCount < prevCount.current;
    wasDecoding.current = decoding;
    prevCount.current = designCount;
    if (!done && !removed) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const add = addRef.current && !addRef.current.disabled ? addRef.current : null;
    (multi ? (add ?? dropRef.current) : design ? replaceRef.current : dropRef.current)?.focus();
  }, [decoding, design, multi, designCount]);

  const prefill = design && shape ? pdfPrefillUm(design, shape) : null;
  const acceptedCopy = shape === 'custom' ? builder.upload.acceptedCustom : builder.upload.accepted;
  const limitMb = uploadLimitMb(b.settings.maxUploadBytes);
  const accepted = fillLtr(acceptedCopy, { mb: limitMb });

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        id="design-file"
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        multiple={b.multi}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ''; // allow re-picking the same file
        }}
      />
      {b.multi && (
        <input
          ref={replaceInputRef}
          id="design-replace-file"
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            replaceDesign(e.target.files);
            e.target.value = '';
          }}
        />
      )}

      {/* Always mounted (a region added together with its text is announced unreliably); empty when idle. */}
      <p role="status" className="sr-only">
        {decoding ? common.status.loading : ''}
      </p>

      {!design && (
        <button
          ref={dropRef}
          type="button"
          disabled={decoding}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files);
          }}
          className={cn(
            'flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-card p-6 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
            dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/40',
          )}
        >
          {decoding ? (
            <>
              <LoaderCircle className="size-9 animate-spin text-brand" aria-hidden />
              <span className="text-sm font-medium">
                {common.status.loading}
              </span>
            </>
          ) : (
            <>
              <CloudUpload className="size-10 text-brand" aria-hidden />
              <span className="text-base font-bold">{builder.upload.drop}</span>
              <span className="text-sm text-muted-foreground">{accepted}</span>
            </>
          )}
        </button>
      )}

      {b.multi && <DesignCards b={b} limitMb={limitMb} addRef={addRef} onReplace={openReplace} onAdd={() => inputRef.current?.click()} />}
      {/* Mounted as soon as the box is ticked (like the status above), so the notice is read aloud when its text appears. */}
      {b.multi && (
        <p role="status" className={capNotice ? 'rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground' : 'sr-only'}>
          {capNotice ? fillLtr(builder.multi.limitNotice, { max: MAX_DESIGNS }) : ''}
        </p>
      )}

      {design && !b.multi && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-4">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL preview */}
              <img src={design.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Ltr className="truncate">{design.file.name}</Ltr>
              </p>
              <p className="text-xs text-muted-foreground">
                <Ltr>
                  {design.pxWidth} × {design.pxHeight}
                </Ltr>{' '}
                {builder.upload.pixelsUnit}
              </p>
              <Button ref={replaceRef} type="button" variant="outline" className="h-11 px-4" disabled={decoding} onClick={() => inputRef.current?.click()}>
                {decoding ? common.status.loading : builder.upload.replace}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* In a multi-design order these notes sit inside each design's card (they name the design they are about). */}
      {!b.multi && design?.pdf && design.pdf.pageCount > 1 && (
        <Notice>{fillLtr(builder.upload.onlyFirstPage, { pages: design.pdf.pageCount })}</Notice>
      )}
      {!b.multi && prefill && (
        <Notice>{fillLtr(builder.upload.detectedSize, { size: `${safeFormatCm(prefill.widthUm)} × ${safeFormatCm(prefill.heightUm)}` })}</Notice>
      )}
      {!b.multi && needsCropNotice(shape ?? 'rect', design) && <Notice>{builder.upload.cropNotice}</Notice>}
      {shape === 'circle' && !design && <p className="text-sm text-muted-foreground">{builder.upload.squareHint}</p>}
      {shape === 'custom' && !design && <p className="text-sm text-muted-foreground">{builder.upload.transparentHint}</p>}

      {designError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{fillLtr(builder.upload.errors[designError], { mb: limitMb })}</p>
          {designError === 'no_alpha' && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => b.setShape('rect')}>
              {builder.upload.errors.switchToRect}
            </Button>
          )}
        </div>
      )}

      {/* Upload mode only: several designs in one order (all of the one shape, each with its own size). */}
      <div className="flex items-start gap-3">
        <input
          id="multi-designs"
          type="checkbox"
          checked={b.multi}
          onChange={(ev) => {
            setCapNotice(false);
            b.setMulti(ev.target.checked);
          }}
          className="mt-0.5 size-5 shrink-0 accent-brand"
        />
        <div className="space-y-1">
          <Label htmlFor="multi-designs" className="font-normal leading-relaxed">
            {builder.multi.checkbox}
          </Label>
          {b.multi && <p className="text-xs text-muted-foreground">{builder.multi.hint}</p>}
        </div>
      </div>
    </div>
  );
}

/** The design cards of a multi-design order: preview, name, «مفرغ», replace and remove, then «إضافة تصميم». */
function DesignCards({
  b,
  limitMb,
  addRef,
  onReplace,
  onAdd,
}: {
  b: BuilderApi;
  limitMb: number;
  addRef: React.Ref<HTMLButtonElement>;
  onReplace: (index: number) => void;
  onAdd: () => void;
}) {
  const cards = b.rows.filter((r) => r.design || r.decoding || (r.index > 0 && r.error));
  const full = b.designCount >= MAX_DESIGNS;
  const busy = b.rows.some((r) => r.decoding);
  return (
    <div className="space-y-3">
      {cards.length > 0 && (
        <ul className="space-y-3">
          {cards.map((r) => (
            <DesignCard key={r.id} b={b} r={r} limitMb={limitMb} onReplace={() => onReplace(r.index)} />
          ))}
        </ul>
      )}
      {(b.design || cards.length > 0) && (
        <Button ref={addRef} type="button" variant="outline" className="h-12 w-full gap-2 px-4 text-base" disabled={full} onClick={onAdd}>
          <Plus className="size-5" aria-hidden />
          {builder.multi.add}
          <Ltr className="text-sm text-muted-foreground">
            {b.designCount}/{MAX_DESIGNS}
          </Ltr>
        </Button>
      )}
      <p role="status" className="sr-only">
        {busy ? common.status.loading : ''}
      </p>
    </div>
  );
}

function DesignCard({ b, r, limitMb, onReplace }: { b: BuilderApi; r: DesignRow; limitMb: number; onReplace: () => void }) {
  const n = r.index + 1;
  const d = r.design;
  const prefill = d && b.shape ? pdfPrefillUm(d, b.shape) : null;
  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
          {d ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL preview
            <img src={d.previewUrl} alt="" className="max-h-full max-w-full object-contain" />
          ) : r.decoding ? (
            <LoaderCircle className="size-7 animate-spin text-brand" aria-hidden />
          ) : (
            <TriangleAlert className="size-7 text-destructive" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-base font-bold">{fillLtr(builder.multi.designN, { n })}</h3>
            {d?.hasAlpha && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">{builder.multi.cutOut}</span>}
          </div>
          {d && (
            <>
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Ltr className="truncate">{d.file.name}</Ltr>
              </p>
              <p className="text-xs text-muted-foreground">
                <Ltr>
                  {d.pxWidth} × {d.pxHeight}
                </Ltr>{' '}
                {builder.upload.pixelsUnit}
              </p>
              {d.pdf && d.pdf.pageCount > 1 && <p className="text-xs text-muted-foreground">{fillLtr(builder.upload.onlyFirstPage, { pages: d.pdf.pageCount })}</p>}
              {prefill && (
                <p className="text-xs text-muted-foreground">
                  {fillLtr(builder.upload.detectedSize, { size: `${safeFormatCm(prefill.widthUm)} × ${safeFormatCm(prefill.heightUm)}` })}
                </p>
              )}
              {needsCropNotice(b.shape ?? 'rect', d) && <p className="text-xs text-muted-foreground">{builder.upload.cropNotice}</p>}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Button type="button" variant="outline" size="icon" className="size-11" disabled={r.decoding} aria-label={fill(builder.multi.replaceN, { n })} onClick={onReplace}>
            <RefreshCw className="size-4" aria-hidden />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-11" aria-label={fill(builder.multi.removeN, { n })} onClick={() => b.removeDesign(r.index)}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {r.index > 0 && r.error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{fillLtr(builder.upload.errors[r.error], { mb: limitMb })}</p>
          {r.error === 'no_alpha' && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => b.setShape('rect')}>
              {builder.upload.errors.switchToRect}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

