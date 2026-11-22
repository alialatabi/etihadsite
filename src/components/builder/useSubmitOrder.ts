'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { rasterisePdfPage } from '@/lib/design/decode.client';
import { uploadLimitMb } from '@/lib/upload-limit';
import { PRINT_DPI } from '@/lib/print-dpi';
import { clearDraftFile } from './draft-store';
import { clearDraft, saveSuccess } from './logic';
import { logClient } from './logClient';
import { postOrder, uploadWithProgress } from './orderApi';
import { attemptFingerprint, clearStoredAttempt, keepAttemptAfterError, loadStoredAttempt, rememberUpload, resolveAttempt, saveStoredAttempt, type KeptAttempt } from './submitAttempt';
import { submitOrderFlow, type SubmitInput } from './submitFlow';
import { submitMultiFlow } from './submitMultiFlow';

type SubmitPhase = 'idle' | 'uploading' | 'processing' | 'failed' | 'degraded';

export interface SubmitState {
  phase: SubmitPhase;
  /** 0..1 while uploading. */
  progress: number;
  message: string | null;
}

export function useSubmitOrder(maxUploadBytes: number) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ phase: 'idle', progress: 0, message: null });
  const keptRef = useRef<KeptAttempt | null>(null);
  const busy = useRef(false);

  /** `seedUploadId`: the accepted AI design's upload, when the design being ordered is that file (logic.ts seedUploadId). */
  const submit = useCallback(
    async (input: SubmitInput, seedUploadId?: string) => {
      if (busy.current) return;
      busy.current = true;
      // One id per order: a retry of the SAME order keeps it (server idempotency), also after a reload (sessionStorage);
      // an order the customer changed since gets a fresh id (and a fresh upload when the design changed).
      const fp = attemptFingerprint(input, seedUploadId);
      const ctx = resolveAttempt({ kept: keptRef.current, stored: loadStoredAttempt(), fp, seedUploadId, newId: nanoid });
      keptRef.current = { ctx, fp };
      saveStoredAttempt(ctx.orderId, fp.order, Date.now(), undefined, ctx);
      setState({ phase: 'uploading', progress: 0, message: null });
      const multi = Boolean(input.extras?.length);
      const result = await (multi ? submitMultiFlow : submitOrderFlow)(input, ctx, {
        // The finished upload is remembered, so a retry after a reload sends the same upload id (the server replays only for it).
        // A multi-design order remembers ALL its uploads at once (`remember`), not just the one that finished last.
        upload: multi ? uploadWithProgress : rememberUpload(uploadWithProgress, ctx, fp.order),
        remember: multi ? (c) => saveStoredAttempt(c.orderId, fp.order, Date.now(), undefined, c) : undefined,
        postOrder,
        rasterise: rasterisePdfPage,
        targetDpi: PRINT_DPI,
        maxUploadMb: uploadLimitMb(maxUploadBytes),
        onPhase: (phase) => setState((s) => ({ ...s, phase, progress: phase === 'processing' ? 1 : 0 })),
        // The UI shows whole percents: keep the same state object (no re-render) until that changes.
        onProgress: (progress) => setState((s) => (Math.round(s.progress * 100) === Math.round(progress * 100) ? s : { ...s, progress })),
      });
      busy.current = false;

      if (result.kind === 'ok') {
        keptRef.current = null;
        clearStoredAttempt();
        saveSuccess(result.response);
        clearDraft();
        void clearDraftFile();
        router.push('/order/success');
        return;
      }
      logClient(
        {
          step: result.kind === 'degraded' ? 'upload' : 'order',
          message: result.kind === 'degraded' ? result.reason : `${result.code}: ${result.message}`,
          fileType: input.design.file.type,
          fileSize: input.design.file.size,
        },
        // The degraded screen (WhatsApp fallback) is a real failure; a validation error is not.
        result.kind === 'degraded' ? { report: { error: result.error ?? new Error(`Order flow degraded: ${result.reason}`) } } : {},
      );
      if (result.kind === 'degraded') {
        setState({ phase: 'degraded', progress: 0, message: null });
      } else {
        // A fixable error ends the attempt (next one gets a fresh id), except rate_limited: an earlier try with this id may
        // have been saved, and the next attempt must reach the server's idempotency with the same id.
        if (!keepAttemptAfterError(result.code)) {
          keptRef.current = null;
          clearStoredAttempt();
        }
        setState({ phase: 'failed', progress: 0, message: result.message });
      }
    },
    [router, maxUploadBytes],
  );

  return { state, submit };
}
