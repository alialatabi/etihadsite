'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { rasterisePdfPage } from '@/lib/design/decode.client';
import { uploadLimitMb } from '@/lib/upload-limit';
import { clearForm, saveSuccess } from './logic';
import { logClient } from './logClient';
import { postOrder, uploadWithProgress } from './orderApi';
import { submitOrderFlow, type AttemptContext, type SubmitInput } from './submitFlow';

type SubmitPhase = 'idle' | 'uploading' | 'processing' | 'failed' | 'degraded';

export interface SubmitState {
  phase: SubmitPhase;
  /** 0..1 while uploading. */
  progress: number;
  message: string | null;
}

export function useSubmitOrder(targetDpi: number, maxUploadBytes: number) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ phase: 'idle', progress: 0, message: null });
  const ctxRef = useRef<AttemptContext | null>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (input: SubmitInput) => {
      if (busy.current) return;
      busy.current = true;
      // One id per attempt; retries after a network failure keep it (server idempotency).
      ctxRef.current ??= { orderId: nanoid(), rastered: false };
      setState({ phase: 'uploading', progress: 0, message: null });
      const result = await submitOrderFlow(input, ctxRef.current, {
        upload: uploadWithProgress,
        postOrder,
        rasterise: rasterisePdfPage,
        targetDpi,
        maxUploadMb: uploadLimitMb(maxUploadBytes),
        onPhase: (phase) => setState((s) => ({ ...s, phase, progress: phase === 'processing' ? 1 : 0 })),
        // The UI shows whole percents: keep the same state object (no re-render) until that changes.
        onProgress: (progress) => setState((s) => (Math.round(s.progress * 100) === Math.round(progress * 100) ? s : { ...s, progress })),
      });
      busy.current = false;

      if (result.kind === 'ok') {
        saveSuccess(result.response);
        clearForm();
        router.push('/order/success');
        return;
      }
      logClient({
        step: result.kind === 'degraded' ? 'upload' : 'order',
        message: result.kind === 'degraded' ? result.reason : `${result.code}: ${result.message}`,
        fileType: input.design.file.type,
        fileSize: input.design.file.size,
      });
      if (result.kind === 'degraded') {
        setState({ phase: 'degraded', progress: 0, message: null });
      } else {
        ctxRef.current = null; // fixable error → next attempt gets a fresh id
        setState({ phase: 'failed', progress: 0, message: result.message });
      }
    },
    [router, targetDpi, maxUploadBytes],
  );

  return { state, submit };
}
