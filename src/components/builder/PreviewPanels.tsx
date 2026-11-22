'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Maximize2 } from 'lucide-react';
import { builder, common } from '@/content/ar';
import { umToMm } from '@/lib/units';
import { resolveShapeSpacing, shapeKeyOf } from '@/lib/layout/spacing';
import { fillLtr } from '@/components/fill-ltr';
import { Ltr } from '@/components/Ltr';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SheetPreview } from './SheetPreview';
import { MultiSheetPreview } from './MultiSheetPreview';
import { CountLabel, SizeLabel } from './labels';
import { hasTurnedCells } from './multi-logic';
import type { BuilderApi } from './useBuilder';
import type { LayoutResult } from '@/lib/types';

/** Top inset for the mobile card's IntersectionObserver: about the height of the sticky header. */
const STRIP_REVEAL_ROOT_MARGIN = '-64px 0px 0px 0px';
/** Size lines the pinned strip of a multi-design order shows before «+N» (so it never grows past its single-design height). */
const STRIP_SIZE_LINES = 2;

/** The page-margin hint shown under the sheet (panel) and in the full-screen dialog. */
const marginHintNodes = (b: BuilderApi) => {
  const lay = b.settings.layout;
  // The margin of the shape being built (known as soon as the shape is picked, before a size is
  // typed); the general margin only while no shape is chosen.
  const key = b.spec
    ? shapeKeyOf(b.spec)
    : b.shape === 'circle'
      ? 'circle'
      : b.shape === 'rect'
        ? b.corners === 'sharp'
          ? 'sharp'
          : 'rounded'
        : b.shape
          ? 'custom'
          : null;
  const marginUm = key ? resolveShapeSpacing(lay, key).marginUm : lay.marginUm;
  return fillLtr(builder.preview.marginHint, { margin: umToMm(marginUm) });
};

/** Desktop (≥ lg): sticky side panel. */
export function PreviewPanel({ b }: { b: BuilderApi }) {
  const { layout, design, spec } = b;
  const previewUrl = design?.previewUrl ?? null;
  const multi = b.multiActive;
  const turnHint = multi ? (b.multiLayout && hasTurnedCells(b.multiLayout) ? builder.preview.mixedHint : null) : layout ? rotationHint(layout) : null;
  const marginHint = marginHintNodes(b);
  const marks = multi ? b.multiLayout?.marks : layout?.marks;
  return (
    <aside aria-label={builder.preview.title} className="hidden lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:block lg:self-start">
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-bold">{builder.preview.title}</h2>
          <span className="text-xs text-muted-foreground">{builder.preview.sheet}</span>
        </div>
        <div className="mx-auto max-w-[320px]">
          {multi ? (
            <MultiSheetPreview layout={b.multiLayout} previewUrls={b.previewUrls} />
          ) : (
            <SheetPreview layout={layout} previewUrl={previewUrl} emptyText={b.mode === 'ai' ? builder.preview.emptyAi : undefined} />
          )}
        </div>
        {multi ? (
          b.multiLayout && <MultiSizes b={b} className="mt-4" />
        ) : (
          spec &&
          layout && (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <SizeLabel widthUm={spec.widthUm} heightUm={spec.heightUm} />
            </p>
          )
        )}
        {turnHint && <p className="mt-2 text-center text-xs text-muted-foreground">{turnHint}</p>}
        <p className="mt-3 text-center text-xs text-muted-foreground">{marginHint}</p>
        {marks && <p className="mt-1 text-center text-xs text-muted-foreground">{common.marksHint}</p>}
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
  const multi = b.multiActive;
  const mLayout = b.multiLayout;
  const ready = multi ? Boolean(mLayout) : Boolean(layout && spec);

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

  if (multi ? !mLayout : !layout || !spec) return null;
  const previewUrl = design?.previewUrl ?? null;
  // Same empty-sheet text as the desktop panel.
  const emptyText = b.mode === 'ai' ? builder.preview.emptyAi : undefined;
  const turnHint = multi ? (mLayout && hasTurnedCells(mLayout) ? builder.preview.mixedHint : null) : layout ? rotationHint(layout) : null;
  const marginHint = marginHintNodes(b);
  const marks = multi ? mLayout?.marks : layout?.marks;
  const perSheet = multi ? (mLayout?.countPerSheet ?? 0) : (layout?.countPerSheet ?? 0);
  // The sheet in one of its three sizes (the card, the pinned strip, the full-screen dialog).
  const sheet = (extra: { hideBadge?: boolean; className?: string } = {}) =>
    multi ? (
      <MultiSheetPreview layout={mLayout} previewUrls={b.previewUrls} emptyText={emptyText} {...extra} />
    ) : (
      <SheetPreview layout={layout} previewUrl={previewUrl} emptyText={emptyText} {...extra} />
    );
  const sizes = multi ? (
    <MultiSizes b={b} />
  ) : (
    spec && <SizeLabel widthUm={spec.widthUm} heightUm={spec.heightUm} />
  );
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
        <div className="mx-auto w-full max-w-[min(300px,calc(55dvh*0.707))]">{sheet()}</div>
        {multi ? (
          <div className="mt-3">{sizes}</div>
        ) : (
          <p className="mt-3 text-center text-sm text-muted-foreground">{sizes}</p>
        )}
        {marks && <p className="mt-1 text-center text-xs text-muted-foreground">{common.marksHint}</p>}
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
          {sheet({ hideBadge: true, className: 'h-full' })}
        </div>
        <div className="min-w-0 flex-1">
          <p className="inline-block rounded-full bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">
            <CountLabel n={perSheet} /> {builder.preview.perSheet}
          </p>
          {multi ? (
            // The pinned strip keeps the height it has with one design: the first lines, then «+N» (the card and the dialog list them all).
            <div className="mt-1.5">
              <MultiSizes b={b} limit={STRIP_SIZE_LINES} />
            </div>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground">{sizes}</p>
          )}
        </div>
        <Maximize2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" showCloseButton={false} className="max-h-[94dvh] overflow-y-auto sm:max-w-md">
          <DialogTitle>{builder.preview.title}</DialogTitle>
          <DialogDescription>{marginHint}</DialogDescription>
          <div className="mx-auto w-full max-w-[min(100%,calc(80dvh*0.707))]">{sheet()}</div>
          {multi && <div>{sizes}</div>}
          {turnHint && <p className="text-center text-xs text-muted-foreground">{turnHint}</p>}
          {marks && <p className="text-center text-xs text-muted-foreground">{common.marksHint}</p>}
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

/** The size of every design on a multi-design sheet, one line each («تصميم 2» … «4 × 6 سم»). */
export function MultiSizes({ b, className, limit }: { b: BuilderApi; className?: string; limit?: number }) {
  const all = b.rows.filter((r) => r.spec);
  if (all.length === 0) return null;
  const rows = limit !== undefined && all.length > limit ? all.slice(0, limit) : all;
  const hidden = all.length - rows.length;
  return (
    <div className={className}>
      <p className="sr-only">{builder.multi.previewSizes}</p>
      <ul className="space-y-0.5 text-sm text-muted-foreground">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3">
            <span>{fillLtr(builder.multi.designN, { n: r.index + 1 })}</span>
            <span>
              <SizeLabel widthUm={r.spec!.widthUm} heightUm={r.spec!.heightUm} />
            </span>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <Ltr>+{hidden}</Ltr>
          </li>
        )}
      </ul>
    </div>
  );
}
