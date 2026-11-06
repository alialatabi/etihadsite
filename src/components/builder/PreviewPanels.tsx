'use client';

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { Ltr } from '@/components/Ltr';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SheetPreview } from './SheetPreview';
import { safeCountLabel, safeSizeLabel } from './safe';
import type { BuilderApi } from './useBuilder';

/** Desktop (≥ lg): sticky side panel. */
export function PreviewPanel({ b }: { b: BuilderApi }) {
  const { layout, design, spec } = b;
  return (
    <aside aria-label={builder.preview.title} className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-bold">{builder.preview.title}</h2>
          <span className="text-xs text-muted-foreground">
            {builder.preview.sheet} · <Ltr>{common.units.a4}</Ltr>
          </span>
        </div>
        <div className="mx-auto max-w-[320px]">
          <SheetPreview layout={layout} previewUrl={design?.previewUrl ?? null} />
        </div>
        {spec && layout && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Ltr>{safeSizeLabel(spec.widthUm, spec.heightUm)}</Ltr>
          </p>
        )}
        {layout?.rotated && <p className="mt-2 text-center text-xs text-muted-foreground">{builder.preview.rotatedHint}</p>}
        <p className="mt-3 text-center text-xs text-muted-foreground">{builder.preview.marginHint}</p>
      </div>
    </aside>
  );
}

/** Mobile: compact sticky strip, tap to expand into a full-screen preview. */
export function MobilePreviewStrip({ b }: { b: BuilderApi }) {
  const [open, setOpen] = useState(false);
  const { layout, design, spec } = b;
  if (!layout || !spec) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={builder.preview.expand}
        className="sticky top-[var(--header-h,0px)] z-30 flex min-h-[110px] w-full items-center gap-4 border-b bg-background/95 px-4 py-2 text-start backdrop-blur outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
      >
        <div className="h-[90px] w-[64px] shrink-0">
          <SheetPreview layout={layout} previewUrl={design?.previewUrl ?? null} hideBadge className="h-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="inline-block rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
            <Ltr>{safeCountLabel(layout.countPerSheet)}</Ltr> {builder.preview.perSheet}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <Ltr>{safeSizeLabel(spec.widthUm, spec.heightUm)}</Ltr>
          </p>
        </div>
        <Maximize2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-h-[94dvh] overflow-y-auto sm:max-w-md">
          <DialogTitle>{builder.preview.title}</DialogTitle>
          <DialogDescription>{builder.preview.marginHint}</DialogDescription>
          <div className="mx-auto w-full max-w-[min(100%,calc(80dvh*0.707))]">
            <SheetPreview layout={layout} previewUrl={design?.previewUrl ?? null} />
          </div>
          {layout.rotated && <p className="text-center text-xs text-muted-foreground">{builder.preview.rotatedHint}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
