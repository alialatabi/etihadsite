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
  DirectUploadStart,
  Material,
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
  material: Material;
  sheets: number;
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
      material: input.material,
      sheets: input.sheets,
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
    const message =
      res.error === 'invalid_quantity' ? builder.quantity.errors.invalid_quantity : (order.errors[res.error] ?? res.message ?? common.errors.generic);
    return { kind: 'error', code: res.error, message };
  } catch (e) {
    return { kind: 'degraded', reason: e instanceof Error ? e.message : 'unknown' };
  }
}

/**
 * Upload the design. Asks the server first: with cloud storage the file goes straight from
 * the browser to the bucket through a one-time signed URL (hosting caps request bodies at
 * 4.5 MB), then the server checks the stored bytes. With local storage it is the classic
 * multipart POST /api/upload. Rejects on network failure.
 */
export async function uploadWithProgress(file: File, onProgress: (fraction: number) => void): Promise<UploadResponse> {
  const startRes = await fetch('/api/upload/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: file.size, name: file.name }),
  });
  let start: DirectUploadStart;
  try {
    start = (await startRes.json()) as DirectUploadStart;
  } catch {
    throw new Error(`bad_upload_start_${startRes.status}`);
  }
  if (!start.ok) return start;
  if (start.mode === 'server') return xhrSend('POST', '/api/upload', multipart(file), onProgress, true);

  try {
    await xhrSend('PUT', start.url, file, onProgress, false);
  } catch (e) {
    // The bucket refuses files over its limit (413, or 400 with "Payload too large").
    if (e instanceof Error && /^direct_upload_(413|400)$/.test(e.message) && file.size > 0) {
      return { ok: false, error: 'too_large', message: order.errors.too_large };
    }
    throw e;
  }
  const commit = await fetch('/api/upload/direct/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId: start.uploadId, name: file.name }),
  });
  try {
    return (await commit.json()) as UploadResponse;
  } catch {
    throw new Error(`bad_upload_commit_${commit.status}`);
  }
}

function multipart(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

/** XHR (not fetch) so the browser reports upload progress. */
function xhrSend(
  method: 'POST' | 'PUT',
  url: string,
  body: FormData | File,
  onProgress: (fraction: number) => void,
  parseJson: true,
): Promise<UploadResponse>;
function xhrSend(method: 'POST' | 'PUT', url: string, body: FormData | File, onProgress: (fraction: number) => void, parseJson: false): Promise<void>;
function xhrSend(
  method: 'POST' | 'PUT',
  url: string,
  body: FormData | File,
  onProgress: (fraction: number) => void,
  parseJson: boolean,
): Promise<UploadResponse | void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = 'text';
    if (body instanceof File) xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    xhr.onload = () => {
      if (!parseJson) {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`direct_upload_${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
      } catch {
        reject(new Error(`bad_upload_response_${xhr.status}`));
      }
    };
    xhr.send(body);
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
