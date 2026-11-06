'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nanoid } from 'nanoid';
import { builder, common, order } from '@/content/ar';
import { rasterisePdfPage } from '@/lib/design/decode.client';
import { clearForm, saveSuccess } from './logic';
import { logClient } from './logClient';
import type {
  CustomerInfo,
  DesignSource,
  OrderError,
  OrderRequest,
  OrderResponse,
  StickerSpec,
  UploadResponse,
} from '@/lib/types';

export type OrderOk = Extract<OrderResponse, { ok: true }>;

export interface SubmitInput {
  design: DesignSource;
  spec: StickerSpec;
  offerId: string;
  customer: CustomerInfo;
}

/** Mutable per-attempt context: keeps the idempotency key (and finished upload) across retries. */
export interface AttemptContext {
  orderId: string;
  uploadId?: string;
  rastered: boolean;
}

export type FlowResult =
  | { kind: 'ok'; response: OrderOk }
  /** A problem the customer can fix (message is Arabic). */
  | { kind: 'error'; code: OrderError | 'upload_error'; message: string }
  /** Network / server failure: offer the WhatsApp fallback. */
  | { kind: 'degraded'; reason: string };

export interface FlowDeps {
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<UploadResponse>;
  postOrder: (body: OrderRequest) => Promise<OrderResponse>;
  rasterise: (file: File, dpi: number) => Promise<Blob>;
  onPhase: (phase: 'uploading' | 'processing') => void;
  onProgress: (fraction: number) => void;
  targetDpi: number;
}

const UPLOAD_ERROR_COPY: Record<string, string> = {
  unsupported_type: order.errors.unsupported_type,
  corrupt: order.errors.corrupt,
  rate_limited: common.errors.rateLimited,
};

/** The upload → order sequence, free of React so it can be unit-tested. */
export async function submitOrderFlow(input: SubmitInput, ctx: AttemptContext, deps: FlowDeps): Promise<FlowResult> {
  try {
    const doUpload = async (file: File): Promise<FlowResult | null> => {
      deps.onPhase('uploading');
      const up = await deps.upload(file, deps.onProgress);
      if (!up.ok) {
        if (up.error === 'server_error') return { kind: 'degraded', reason: `upload:${up.error}` };
        const message = up.error === 'too_large' ? builder.upload.errors.too_large : (UPLOAD_ERROR_COPY[up.error] ?? common.errors.generic);
        return { kind: 'error', code: 'upload_error', message };
      }
      ctx.uploadId = up.uploadId;
      return null;
    };

    const body = (): OrderRequest => ({
      orderId: ctx.orderId,
      uploadId: ctx.uploadId as string,
      spec: input.spec,
      offerId: input.offerId,
      customer: input.customer,
    });

    if (!ctx.uploadId) {
      const failed = await doUpload(input.design.file);
      if (failed) return failed;
    }

    deps.onPhase('processing');
    let res = await deps.postOrder(body());

    if (!res.ok && res.error === 'needs_raster' && !ctx.rastered && input.design.kind === 'pdf') {
      ctx.rastered = true;
      const blob = await deps.rasterise(input.design.file, deps.targetDpi);
      const png = new File([blob], input.design.file.name.replace(/\.pdf$/i, '') + '.png', { type: 'image/png' });
      const failed = await doUpload(png);
      if (failed) return failed;
      deps.onPhase('processing');
      res = await deps.postOrder(body());
    }

    if (res.ok) return { kind: 'ok', response: res };
    if (res.error === 'server_error') return { kind: 'degraded', reason: 'order:server_error' };
    return { kind: 'error', code: res.error, message: order.errors[res.error] ?? res.message ?? common.errors.generic };
  } catch (e) {
    return { kind: 'degraded', reason: e instanceof Error ? e.message : 'unknown' };
  }
}

/** XHR (not fetch) so the browser reports upload progress. Rejects on network failure. */
export function uploadWithProgress(file: File, onProgress: (fraction: number) => void): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
      } catch {
        reject(new Error(`bad_upload_response_${xhr.status}`));
      }
    };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

async function postOrder(body: OrderRequest): Promise<OrderResponse> {
  const r = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    return (await r.json()) as OrderResponse;
  } catch {
    throw new Error(`bad_order_response_${r.status}`);
  }
}

export type SubmitPhase = 'idle' | 'uploading' | 'processing' | 'failed' | 'degraded';

export interface SubmitState {
  phase: SubmitPhase;
  /** 0..1 while uploading. */
  progress: number;
  message: string | null;
}

export function useSubmitOrder(targetDpi: number) {
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
        onPhase: (phase) => setState((s) => ({ ...s, phase, progress: phase === 'processing' ? 1 : 0 })),
        onProgress: (progress) => setState((s) => ({ ...s, progress })),
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
    [router, targetDpi],
  );

  const reset = useCallback(() => setState({ phase: 'idle', progress: 0, message: null }), []);

  return { state, submit, reset };
}
