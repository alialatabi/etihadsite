'use client';

import { useEffect, useRef, useState } from 'react';
import { admin, fill } from '@/content/ar';
import { loadPdfjs, type PdfjsModule } from '@/lib/design/decode.client';
import { reportClientError } from '@/lib/monitoring/report.client';
import { cn } from '@/lib/utils';
import {
  SHEET_ASPECT,
  createJobSignal,
  createSerialQueue,
  previewCanvasWidth,
  type PreviewVariant,
} from './sheet-preview-logic';

type PdfDocument = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;

/** One PDF is fetched + rasterised at a time across the whole page (the orders list can hold hundreds). */
const renderQueue = createSerialQueue();

/** Start loading a thumbnail when its box is within this distance of the viewport. */
const NEAR_VIEWPORT = '300px';

/**
 * Draws page 1 of an order's stored sheet PDF (GET /api/admin/files/<orderId>/pdf) onto a canvas.
 * The URL is fetched per render and never cached: on cloud storage it redirects to a 60 s signed link.
 * `thumb` waits until it is near the viewport; `large` starts at once. Never throws: failure shows a short message.
 */
export function SheetPdfPreview({
  orderId,
  displayNo,
  variant,
  className,
}: {
  orderId: string;
  displayNo: string;
  variant: PreviewVariant;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(variant === 'large');
  // The orderId the result belongs to; null while loading.
  const [done, setDone] = useState<{ orderId: string; ok: boolean } | null>(null);

  // Set once this box's job has begun running; from then on leaving the viewport no longer cancels it.
  const startedRef = useRef(false);

  useEffect(() => {
    if (variant === 'large') return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (!last) return;
        // Entering queues the job; leaving before its turn un-queues it (the effect below aborts it).
        if (last.isIntersecting) setNear(true);
        else if (!startedRef.current) setNear(false);
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [variant]);

  useEffect(() => {
    if (!near) return;
    startedRef.current = false;
    const ac = new AbortController();
    const { signal } = ac;
    renderQueue(async () => {
      startedRef.current = true;
      const job = createJobSignal(signal);
      const js = job.signal;
      let pdf: PdfDocument | null = null;
      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('no canvas');
        const res = await fetch(`/api/admin/files/${encodeURIComponent(orderId)}/pdf`, { cache: 'no-store', signal: js });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        if (signal.aborted) return false;
        if (js.aborted) throw new Error('timeout');
        const pdfjs = await loadPdfjs();
        const loading = pdfjs.getDocument({ data, isEvalSupported: false });
        const onLoadAbort = () => void loading.destroy().catch(() => undefined);
        js.addEventListener('abort', onLoadAbort);
        try {
          pdf = await loading.promise;
        } finally {
          js.removeEventListener('abort', onLoadAbort);
        }
        if (signal.aborted) return false;
        if (js.aborted) throw new Error('timeout');
        const page = await pdf.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = previewCanvasWidth(variant, window.devicePixelRatio) / base.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const task = page.render({ canvas, canvasContext: ctx, viewport });
        const onAbort = () => task.cancel();
        js.addEventListener('abort', onAbort);
        try {
          await task.promise;
        } finally {
          js.removeEventListener('abort', onAbort);
        }
        return !signal.aborted;
      } finally {
        job.dispose();
        if (pdf) await pdf.destroy().catch(() => undefined);
      }
    }, signal).then(
      (ok) => {
        if (!signal.aborted && ok) setDone({ orderId, ok: true });
      },
      (e) => {
        if (signal.aborted) return;
        // A timeout, a cancelled fetch or an HTTP error (the server reports its own 5xx) is not reported; a chunk/worker load failure or a render error is ours to know about.
        if (e instanceof Error && e.name !== 'AbortError' && e.message !== 'timeout' && !e.message.startsWith('HTTP ')) {
          reportClientError(e, { where: 'admin.sheetPreview', tags: { orderId } });
        }
        setDone({ orderId, ok: false });
      },
    );
    return () => ac.abort();
  }, [near, orderId, variant]);

  const state = done && done.orderId === orderId ? (done.ok ? 'ready' : 'error') : 'loading';
  const baseLabel = fill(admin.preview.label, { no: displayNo });
  const label = state === 'error' ? `${baseLabel} - ${admin.preview.error}` : baseLabel;
  const small = variant === 'thumb';

  return (
    <div
      ref={boxRef}
      role="img"
      aria-label={label}
      aria-busy={state === 'loading'}
      style={{ aspectRatio: `${SHEET_ASPECT.width} / ${SHEET_ASPECT.height}` }}
      className={cn(
        'relative w-full overflow-hidden rounded-md border bg-white shadow-sm',
        small ? 'max-w-24' : 'mx-auto max-w-[720px]',
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn('absolute inset-0 block size-full', state !== 'ready' && 'invisible')}
        aria-hidden="true"
      />
      {state !== 'ready' ? (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center p-2 text-center text-muted-foreground',
            small ? 'text-[10px] leading-tight' : 'text-sm',
            state === 'loading' && 'animate-pulse bg-muted/40',
          )}
        >
          {state === 'error' ? admin.preview.error : small ? <span className="sr-only">{admin.preview.loading}</span> : admin.preview.loading}
        </div>
      ) : null}
    </div>
  );
}
