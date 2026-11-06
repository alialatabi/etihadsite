'use client';

import { useRef, useState } from 'react';
import { CloudUpload, FileText, LoaderCircle, TriangleAlert } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fillNodes } from '../fillNodes';
import { needsCropNotice, pdfPrefillUm } from '../logic';
import { safeFormatCm } from '../safe';
import type { BuilderApi } from '../useBuilder';

export function DesignStep({ b }: { b: BuilderApi }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { design, decoding, designError, shape } = b;

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void b.onFile(f);
  };

  const prefill = design && shape ? pdfPrefillUm(design, shape) : null;
  const accepted = shape === 'custom' ? builder.upload.acceptedCustom : builder.upload.accepted;

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        id="design-file"
        type="file"
        accept=".png,.jpg,.jpeg,.pdf"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ''; // allow re-picking the same file
        }}
      />

      {!design && (
        <button
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
              <span role="status" className="text-sm font-medium">
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

      {design && (
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
                </Ltr>
              </p>
              <Button type="button" variant="outline" className="h-11 px-4" disabled={decoding} onClick={() => inputRef.current?.click()}>
                {decoding ? common.status.loading : builder.upload.replace}
              </Button>
            </div>
          </div>
        </div>
      )}

      {design?.pdf && design.pdf.pageCount > 1 && (
        <Notice>{fillNodes(builder.upload.onlyFirstPage, { pages: design.pdf.pageCount })}</Notice>
      )}
      {prefill && (
        <Notice>{fillNodes(builder.upload.detectedSize, { size: `${safeFormatCm(prefill.widthUm)} × ${safeFormatCm(prefill.heightUm)}` })}</Notice>
      )}
      {needsCropNotice(shape ?? 'rect', design) && <Notice>{builder.upload.cropNotice}</Notice>}
      {shape === 'circle' && !design && <p className="text-sm text-muted-foreground">{builder.upload.squareHint}</p>}
      {shape === 'custom' && !design && <p className="text-sm text-muted-foreground">{builder.upload.transparentHint}</p>}

      {designError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{builder.upload.errors[designError]}</p>
          {designError === 'no_alpha' && (
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => b.setShape('rect')}>
              {builder.upload.errors.switchToRect}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

