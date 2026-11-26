'use client';

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CloudUpload, FileDown, LoaderCircle, TriangleAlert } from 'lucide-react';
import { ACCEPTED_EXTENSIONS } from '@/config/defaults';
import { builder, common, staff } from '@/content/ar';
import { Button } from '@/components/ui/button';
import { fillLtr } from '@/components/fill-ltr';
import { uploadLimitMb } from '@/lib/upload-limit';
import { cn } from '@/lib/utils';
import type { QualitySettings } from '@/lib/types';
import { Counted, saveFile } from '../staff-shared';
import { ReceiptCard } from './ReceiptCard';
import { MAX_RECEIPT_FILES, MAX_RECEIPT_FILE_BYTES, downloadReceiptFiles, type ReceiptCardState } from './receipt-logic';
import { useReceiptItems } from './useReceiptItems';

/** The receipts (الوصولات) tab: pick receipt designs, choose each one's format, download one A4 PDF per design. */
export function StaffReceipts({ quality }: { quality: QualitySettings }) {
  const s = useReceiptItems(quality);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReactNode>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);

  const pick = (files: FileList | null) => {
    if (files && files.length) s.add(Array.from(files));
  };

  const run = async (targets: ReceiptCardState[]) => {
    if (busy || targets.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const summary = await downloadReceiptFiles(targets, {
        save: saveFile,
        onProgress: (n, total) => setProgress({ n, total }),
      });
      if (summary.failed.length) {
        const mb = uploadLimitMb(MAX_RECEIPT_FILE_BYTES);
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
  // The card buttons get a stable handler so the memoised ReceiptCards skip re-renders while decoding.
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
  const accepted = fillLtr(staff.accepted, { max: MAX_RECEIPT_FILES, mb: uploadLimitMb(MAX_RECEIPT_FILE_BYTES) });

  return (
    <div className="space-y-6">
      <input
        ref={inputRef}
        id="receipt-files"
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
          'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-card p-6 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
          n === 0 ? 'min-h-44' : 'min-h-28',
          dragging ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/40',
        )}
      >
        <CloudUpload className="size-9 text-brand" aria-hidden />
        <span className="text-base font-bold">{n === 0 ? staff.drop : staff.dropMore}</span>
        <span className="text-sm text-muted-foreground">{accepted}</span>
      </button>

      {s.tooMany && (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {fillLtr(staff.tooMany, { max: MAX_RECEIPT_FILES })}
        </p>
      )}

      {n === 0 && <p className="text-center text-sm text-muted-foreground">{staff.receipts.empty}</p>}

      {n > 0 && (
        <ul className="space-y-4">
          {s.cards.map((card, i) => (
            <ReceiptCard key={card.id} card={card} view={s.views[i]} onFormat={s.setFormat} onTurn={s.turn} onWhite={s.setWhite} onRemove={s.remove} onDownload={downloadOne} busy={busy} />
          ))}
        </ul>
      )}

      <div className="space-y-3 rounded-2xl border bg-card p-4">
        {n > 0 && (
          <p className="text-sm font-medium">
            {fillLtr(staff.receipts.summary, {
              receipts: <Counted n={n} forms={common.plural.receipt} />,
              files: <Counted n={n} forms={common.plural.file} />,
            })}
          </p>
        )}
        <Button type="button" className="h-12 w-full px-6 text-base sm:w-auto" disabled={!s.ready || busy} onClick={download}>
          {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <FileDown className="size-5" aria-hidden />}
          {busy ? fillLtr(staff.preparing, { n: progress?.n ?? 1, total: progress?.total ?? 1 }) : staff.download}
        </Button>
        {n > 1 && <p className="text-sm text-muted-foreground">{staff.multiHint}</p>}
        {n > 0 && !s.ready && !busy && <p className="text-sm text-muted-foreground">{staff.needValid}</p>}
        {failure && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{failure}</span>
          </p>
        )}
        <p className="text-sm text-muted-foreground">{fillLtr(staff.receipts.printHint, { percent: 100 })}</p>
      </div>
    </div>
  );
}
