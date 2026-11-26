'use client';

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloudUpload, FileDown, LoaderCircle, TriangleAlert } from 'lucide-react';
import { ACCEPTED_EXTENSIONS } from '@/config/defaults';
import { builder, common, staff } from '@/content/ar';
import { ctaCls, fieldCls } from '@/components/collage';
import { Button } from '@/components/ui/button';
import { fillLtr } from '@/components/fill-ltr';
import { uploadLimitMb } from '@/lib/upload-limit';
import { cn } from '@/lib/utils';
import type { LayoutSettings, QualitySettings } from '@/lib/types';
import { StaffCard } from './StaffCard';
import { MAX_STAFF_FILES, MAX_STAFF_FILE_BYTES, downloadStaffFiles, type StaffCardState } from './staff-logic';
import { Counted, saveFile } from './staff-shared';
import { useStaffItems } from './useStaffItems';

export function StaffSheets({ layoutSettings, quality }: { layoutSettings: LayoutSettings; quality: QualitySettings }) {
  const s = useStaffItems(layoutSettings, quality);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReactNode>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);

  const pick = (files: FileList | null) => {
    if (files && files.length) s.add(Array.from(files));
  };

  const run = async (targets: StaffCardState[]) => {
    if (busy || targets.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const summary = await downloadStaffFiles(targets, layoutSettings, {
        save: saveFile,
        onProgress: (n, total) => setProgress({ n, total }),
      });
      if (summary.failed.length) {
        const mb = uploadLimitMb(MAX_STAFF_FILE_BYTES);
        setFailure(
          summary.failed.map((f) => (
            <span key={f.cardId} className="block">
              {fillLtr(staff.prepareFailed, { name: f.fileName })} {f.reason === 'prepare' ? fillLtr(builder.upload.errors[f.error], { mb }) : common.errors.generic}
            </span>
          )),
        );
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const download = () => {
    if (s.ready) void run(s.cards);
  };
  // The card buttons get a stable handler so the memoised StaffCards skip re-renders while typing or decoding.
  const latest = useRef({ run, cards: s.cards });
  // Layout effect: the ref is current before the browser can deliver a click on a card button.
  useLayoutEffect(() => {
    latest.current = { run, cards: s.cards };
  });
  const downloadOne = useCallback((id: string) => {
    const card = latest.current.cards.find((c) => c.id === id);
    if (card) void latest.current.run([card]);
  }, []);

  const n = s.cards.length;
  const accepted = fillLtr(staff.accepted, { max: MAX_STAFF_FILES, mb: uploadLimitMb(MAX_STAFF_FILE_BYTES) });

  return (
    <div className="space-y-6">
      <input
        ref={inputRef}
        id="staff-files"
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ''; // allow picking the same files again
        }}
      />

      <button
        type="button"
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
          'grid-paper flex w-full flex-col items-center justify-center gap-2 rounded-[2px] border-[3px] border-dashed p-6 text-center outline-none transition-colors focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-ink',
          n === 0 ? 'min-h-44' : 'min-h-28',
          dragging ? 'border-brand bg-brand-tint' : 'border-ink/45 bg-white hover:border-ink',
        )}
      >
        <CloudUpload className="size-9 text-brand" aria-hidden />
        <span className="text-base font-bold text-ink">{n === 0 ? staff.drop : staff.dropMore}</span>
        <span className={fieldCls.hint}>{accepted}</span>
      </button>

      {s.tooMany && (
        <p role="status" className="rounded-[2px] bg-news px-4 py-3 text-sm text-ink-soft">
          {fillLtr(staff.tooMany, { max: MAX_STAFF_FILES })}
        </p>
      )}

      {n === 0 && <p className="text-center text-sm text-muted-foreground">{staff.empty}</p>}

      {n > 0 && (
        <ul className="space-y-4">
          {s.cards.map((card, i) => (
            <StaffCard key={card.id} card={card} view={s.views[i]} onShape={s.setShape} onWidth={s.setWidth} onHeight={s.setHeight} onRemove={s.remove} onDownload={downloadOne} busy={busy} />
          ))}
        </ul>
      )}

      <div className="paper-card space-y-3 p-4">
        {n > 0 && (
          <p className="text-sm font-medium">
            {fillLtr(staff.summary, {
              designs: <Counted n={n} forms={common.plural.design} />,
              files: <Counted n={n} forms={common.plural.file} />,
            })}
          </p>
        )}
        <Button type="button" className={cn(ctaCls('md'), 'w-full sm:w-auto')} disabled={!s.ready || busy} onClick={download}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <FileDown className="size-5" aria-hidden />}
          {busy ? fillLtr(staff.preparing, { n: progress?.n ?? 1, total: progress?.total ?? 1 }) : staff.download}
        </Button>
        {n > 1 && <p className="text-sm text-muted-foreground">{staff.multiHint}</p>}
        {n > 0 && !s.ready && !busy && <p className="text-sm text-muted-foreground">{staff.needValid}</p>}
        {failure && (
          <p role="alert" className="flex items-start gap-2 rounded-[2px] border border-brand-ink/30 bg-brand-tint p-3 text-sm text-brand-ink">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{failure}</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">{fillLtr(staff.printActualSize, { percent: 100 })}</p>
        <p className="text-sm text-muted-foreground">{common.marksHint}</p>
      </div>
    </div>
  );
}
