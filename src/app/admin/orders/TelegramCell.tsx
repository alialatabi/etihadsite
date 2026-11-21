'use client';

import { useActionState } from 'react';
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
export function TelegramSentMark() {
  return (
    <span title={c.telegramSent} className="inline-flex items-center">
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

const compact = 'h-11 w-full px-2 text-[14px]';

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

  if (state.status === 'sent') return <TelegramSentMark />;

  const message = state.status === 'idle' ? null : MESSAGES[state.status];
  return (
    <div className="flex w-[7.75rem] flex-col gap-2 whitespace-normal">
      <span className="text-[13px] leading-[1.4] text-[#5a6475]">{reason}</span>
      {pdfPurged ? (
        <span className="text-[13px] leading-[1.4] text-[#b8163f]">{c.telegramFileMissing}</span>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <a
            href={`/api/admin/files/${orderId}/pdf`}
            download
            className={cn(btn.outline, compact)}
          >
            {c.telegramDownload}
          </a>
          <button type="submit" disabled={pending} className={cn(btn.ink, compact)}>
            {pending ? c.telegramSending : c.telegramResend}
          </button>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-[13px] leading-[1.4] text-[#b8163f]">
        {message}
      </p>
    </div>
  );
}
