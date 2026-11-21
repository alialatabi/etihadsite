'use client';

import { useActionState, useEffect, useRef, type Ref } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { btn } from '@/components/admin/kit';
import { admin } from '@/content/ar';
import { cn } from '@/lib/utils';
import { resendTelegramAction, type TelegramResendState } from './telegram-action';

const c = admin.orders;

/**
 * Owner's decision (2026-11-21): a delivered order shows a plain GREEN check. This overrides
 * the Softy rule "green only for WhatsApp". #15803d is 5:1 on white.
 */
export function TelegramSentMark({ markRef }: { markRef?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={markRef} tabIndex={markRef ? -1 : undefined} title={c.telegramSent} className="inline-flex items-center outline-offset-2">
      <CheckCircle2 aria-hidden className="size-6 text-[#15803d]" />
      <span className="sr-only">{c.telegramSent}</span>
    </span>
  );
}

const MESSAGES: Record<Exclude<TelegramResendState['status'], 'idle' | 'sent'>, string> = {
  failed: c.telegramResendFailed,
  not_configured: c.telegramNotConfigured,
  missing_file: c.telegramFileMissing,
  not_found: c.telegramNotFound,
};

const compact = 'h-11 w-full px-1.5 text-[13px]';

/**
 * Telegram cell for an order that has NOT reached Telegram: download the print PDF, or send
 * it now. `pdfPurged` (older than the retention) hides both: the file is gone.
 */
export function TelegramCell({
  orderId,
  reason,
  pdfPurged,
}: {
  orderId: string;
  reason: string;
  pdfPurged: boolean;
}) {
  const [state, action, pending] = useActionState<TelegramResendState, FormData>(resendTelegramAction, {
    status: 'idle',
  });

  // After a successful send the form (and the focused button) is removed: move focus to the
  // check mark, whose sr-only text is then read out. The status region below stays mounted.
  const sent = state.status === 'sent';
  const markRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (sent) markRef.current?.focus();
  }, [sent]);

  const message = state.status === 'idle' || state.status === 'sent' ? null : MESSAGES[state.status];
  return (
    <div className={cn('flex flex-col gap-2 whitespace-normal', !sent && 'w-[7rem]')}>
      {sent ? (
        <TelegramSentMark markRef={markRef} />
      ) : (
        <>
          <span className="text-[13px] leading-[1.4] text-[#5a6475]">{reason}</span>
          {pdfPurged ? (
            <span className="text-[13px] leading-[1.4] text-[#b8163f]">{c.telegramFileMissing}</span>
          ) : (
            <form action={action} className="flex flex-col gap-2">
              <input type="hidden" name="orderId" value={orderId} />
              <a href={`/api/admin/files/${orderId}/pdf`} download className={cn(btn.outline, compact)}>
                {c.telegramDownload}
              </a>
              <button type="submit" disabled={pending} className={cn(btn.ink, compact)}>
                {pending ? c.telegramSending : c.telegramResend}
              </button>
            </form>
          )}
        </>
      )}
      <p role="status" aria-live="polite" className="text-[13px] leading-[1.4] text-[#b8163f] empty:hidden">
        {message}
      </p>
    </div>
  );
}
