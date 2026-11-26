'use client';

import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { btn, field } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { cn } from '@/lib/utils';
import { errorMessageOf, filenameFromDisposition } from './sheet-download';

const d = admin.designs;

/** A design card is narrow (two per row on a phone): the kit button may wrap its text, still at least 44px tall. */
const CARD_BTN = 'h-auto min-h-11 w-full whitespace-normal px-3 py-2 text-center text-[14px] leading-snug';

/**
 * «نزّل ورقة مسفطة (PDF)» of a design no order printed. The sheet is built on the fly (a few seconds), so the
 * button fetches it, shows a pending state, saves the PDF with the name the route sent, and shows the route's
 * own Arabic error message under the button when it fails.
 */
export function SheetDownloadButton({ href }: { href: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const download = async () => {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(href, { credentials: 'same-origin' });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setMessage(errorMessageOf(body) ?? d.sheet.failed);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFromDisposition(res.headers.get('content-disposition'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      // The browser has started the save by the time this runs; keep the URL a moment so a slow save still works.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setMessage(d.sheet.failed);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={download} disabled={pending} aria-busy={pending} className={cn(btn.outline, CARD_BTN)}>
        {pending ? (
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
        ) : (
          <FileText aria-hidden className="size-4 shrink-0" />
        )}
        {pending ? d.card.sheetPending : d.card.downloadSheet}
      </button>
      {message ? (
        <p role="alert" className={cn(field.error, 'font-medium leading-normal')}>
          {message}
        </p>
      ) : null}
    </>
  );
}
