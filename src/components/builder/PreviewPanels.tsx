'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Maximize2 } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { umToMm } from '@/lib/units';
import { fillLtr } from '@/components/fill-ltr';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SheetPreview } from './SheetPreview';
import { CountLabel, SizeLabel } from './labels';
import type { BuilderApi } from './useBuilder';
import type { LayoutResult } from '@/lib/types';

/** Top inset for the mobile card's IntersectionObserver: about the height of the sticky header. */
const STRIP_REVEAL_ROOT_MARGIN = '-64px 0px 0px 0px';

/** The page-margin hint shown under the sheet (panel) and in the full-screen dialog. */
const marginHintNodes = (b: BuilderApi) => fillLtr(builder.preview.marginHint, { margin: umToMm(b.settings.layout.marginUm) });

/** Desktop (≥ lg): sticky side panel. */
export function PreviewPanel({ b }: { b: BuilderApi }) {
  const { layout, design, spec } = b;
  const previewUrl = design?.previewUrl ?? null;
  const turnHint = layout ? rotationHint(layout) : null;
  const marginHint = marginHintNodes(b);
  return (
    <aside aria-label={builder.preview.title} className="hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:block lg:self-start">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-bold">{builder.preview.title}</h2>
          <span className="text-xs text-muted-foreground">{builder.preview.sheet}</span>
        </div>
        <div className="mx-auto max-w-[320px]">
          <SheetPreview layout={layout} previewUrl={previewUrl} />
        </div>
        {spec && layout && (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <SizeLabel widthUm={spec.widthUm} heightUm={spec.heightUm} />
          </p>
        )}
        {turnHint && <p className="mt-2 text-center text-xs text-muted-foreground">{turnHint}</p>}
        <p className="mt-3 text-center text-xs text-muted-foreground">{marginHint}</p>
        {layout?.marks && <p className="mt-1 text-center text-xs text-muted-foreground">{common.marksHint}</p>}
      </div>
    </aside>
  );
}

/**
 * Mobile (< lg): a large inline A4 card above the step, plus a compact strip pinned under the
 * header that slides in only while the large card is scrolled out of view. Tap either to open
 * a full-screen preview.
 */
export function MobilePreview({ b }: { b: BuilderApi }) {
  const [open, setOpen] = useState(false);
  const [cardVisible, setCardVisible] = useState(true);
  const cardRef = useRef<HTMLButtonElement>(null);
  const { layout, design, spec } = b;
  const ready = Boolean(layout && spec);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // Treat the card as hidden once less than ~15% of it shows below the sticky header.
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting), {
      rootMargin: STRIP_REVEAL_ROOT_MARGIN,
      threshold: 0.15,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  if (!layout || !spec) return null;
  const previewUrl = design?.previewUrl ?? null;
  const turnHint = rotationHint(layout);
  const marginHint = marginHintNodes(b);
  return (
    <>
      <button
        ref={cardRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={builder.preview.expand}
        className="relative block w-full rounded-3xl border bg-card p-4 text-start shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
      >
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <span className="font-heading text-base font-bold">{builder.preview.title}</span>
          <span className="text-xs text-muted-foreground">{builder.preview.sheet}</span>
        </div>
        <div className="mx-auto w-full max-w-[min(300px,calc(55dvh*0.707))]">
          <SheetPreview layout={layout} previewUrl={previewUrl} />
        </div>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          <SizeLabel widthUm={spec.widthUm} heightUm={spec.heightUm} />
        </p>
        {layout.marks && <p className="mt-1 text-center text-xs text-muted-foreground">{common.marksHint}</p>}
        <Maximize2 className="absolute end-4 bottom-4 size-5 text-muted-foreground" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={builder.preview.expand}
        aria-hidden={cardVisible}
        tabIndex={cardVisible ? -1 : 0}
        className={cn(
          'fixed start-0 end-0 top-[var(--header-h)] z-30 flex min-h-[124px] w-full items-center gap-4 border-b bg-background/95 px-4 py-2 text-start shadow-sm backdrop-blur outline-none transition-transform duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none lg:hidden',
          cardVisible ? 'pointer-events-none -translate-y-[calc(100%+var(--header-h))]' : 'translate-y-0',
        )}
      >
        <div className="h-[108px] w-[77px] shrink-0">
          <SheetPreview layout={layout} previewUrl={previewUrl} hideBadge className="h-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="inline-block rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
            <CountLabel n={layout.countPerSheet} /> {builder.preview.perSheet}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            <SizeLabel widthUm={spec.widthUm} heightUm={spec.heightUm} />
          </p>
        </div>
        <Maximize2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" showCloseButton={false} className="max-h-[94dvh] overflow-y-auto sm:max-w-md">
          <DialogTitle>{builder.preview.title}</DialogTitle>
          <DialogDescription>{marginHint}</DialogDescription>
          <div className="mx-auto w-full max-w-[min(100%,calc(80dvh*0.707))]">
            <SheetPreview layout={layout} previewUrl={previewUrl} />
          </div>
          {turnHint && <p className="text-center text-xs text-muted-foreground">{turnHint}</p>}
          {layout.marks && <p className="text-center text-xs text-muted-foreground">{common.marksHint}</p>}
          <DialogClose render={<Button type="button" variant="outline" className="h-12 w-full text-base" />}>{builder.preview.close}</DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Customer hint when some or all stickers are turned 90° to fit more. */
function rotationHint(layout: LayoutResult): string | null {
  if (layout.turnedCount > 0) return builder.preview.mixedHint;
  return layout.rotated ? builder.preview.rotatedHint : null;
}
