import { builder, common, fill, order } from '@/content/ar';
import type {
  CustomerInfo,
  DesignSource,
  Material,
  OrderError,
  OrderRequest,
  OrderResponse,
  StickerSpec,
  UploadError,
  UploadResponse,
} from '@/lib/types';
import type { OrderOk } from './logic';

export interface SubmitInput {
  design: DesignSource;
  spec: StickerSpec;
  material: Material;
  /** What the customer typed. The server works out the sheets from it. */
  stickers: number;
  /** ceil(stickers / countPerSheet) from this page's layout; sent for an older server, which ignores `stickers`. */
  sheets: number;
  customer: CustomerInfo;
}

/** Mutable per-attempt context: keeps the idempotency key (and finished upload) across retries. */
export interface AttemptContext {
  orderId: string;
  uploadId?: string;
  rastered: boolean;
  /** `uploadId` came from an accepted AI design (not this attempt's upload): if the server no longer has it, upload the file once. */
  seeded?: boolean;
  /** The design file this attempt is for: another file starts a new attempt (its upload id would be the old design's). */
  file?: File;
}

/**
 * The context for a submit: the kept one while the design is the same file (a retry after a network failure keeps
 * the order id and the finished upload), else a fresh one, seeded with the accepted AI design's upload when given.
 * The submit hook now decides through `resolveAttempt` (submitAttempt.ts), whose fingerprint covers the design file too;
 * this smaller rule is kept (and unit-tested) as the file-identity check it started as.
 */
export function attemptContextFor(prev: AttemptContext | null, file: File, newId: () => string, seedUploadId?: string): AttemptContext {
  if (prev && prev.file === file) return prev;
  return { orderId: newId(), rastered: false, file, ...(seedUploadId ? { uploadId: seedUploadId, seeded: true } : {}) };
}

export type FlowResult =
  | { kind: 'ok'; response: OrderOk }
  /** A problem the customer can fix (message is Arabic). */
  | { kind: 'error'; code: OrderError | 'upload_error'; message: string }
  /** Network / server failure: offer the WhatsApp fallback. */
  | { kind: 'degraded'; reason: string; /** The thrown value, when there was one (for error reporting; never stored or sent to the API). */ error?: unknown };

export interface FlowDeps {
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<UploadResponse>;
  postOrder: (body: OrderRequest) => Promise<OrderResponse>;
  /** Page 1 of a PDF as a JPEG at `dpi`, sized for the ordered sticker (`target`). */
  rasterise: (file: File, dpi: number, target?: { widthUm: number; heightUm: number }) => Promise<Blob>;
  onPhase: (phase: 'uploading' | 'processing') => void;
  onProgress: (fraction: number) => void;
  targetDpi: number;
  /** The shop upload limit in whole MB (settings.maxUploadBytes), for the too-large message. */
  maxUploadMb: number;
}

/** Copy for an upload the customer can fix ('server_error' degrades instead). */
const uploadErrorCopy = (maxUploadMb: number): Record<Exclude<UploadError, 'server_error'>, string> => ({
  too_large: fill(builder.upload.errors.too_large, { mb: maxUploadMb }),
  unsupported_type: order.errors.unsupported_type,
  corrupt: order.errors.corrupt,
  rate_limited: common.errors.rateLimited,
});

/** The upload → order sequence, free of React so it can be unit-tested. */
export async function submitOrderFlow(input: SubmitInput, ctx: AttemptContext, deps: FlowDeps): Promise<FlowResult> {
  try {
    const doUpload = async (file: File): Promise<FlowResult | null> => {
      deps.onPhase('uploading');
      const up = await deps.upload(file, deps.onProgress);
      if (!up.ok) {
        if (up.error === 'server_error') return { kind: 'degraded', reason: `upload:${up.error}` };
        // The `??` fallbacks cover codes a newer server may send that this bundle does not know.
        const message = uploadErrorCopy(deps.maxUploadMb)[up.error] ?? common.errors.generic;
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
      stickers: input.stickers,
      sheets: input.sheets,
      customer: input.customer,
    });

    if (!ctx.uploadId) {
      const failed = await doUpload(input.design.file);
      if (failed) return failed;
    }

    deps.onPhase('processing');
    let res = await deps.postOrder(body());

    if (!res.ok && res.error === 'upload_missing' && ctx.seeded) {
      // The AI design's upload is gone (purged): send the design file itself, once.
      ctx.seeded = false;
      ctx.rastered = false;
      ctx.uploadId = undefined;
      const failed = await doUpload(input.design.file);
      if (failed) return failed;
      deps.onPhase('processing');
      res = await deps.postOrder(body());
    }

    if (!res.ok && res.error === 'needs_raster' && !ctx.rastered && input.design.kind === 'pdf') {
      ctx.rastered = true;
      let blob = await deps.rasterise(input.design.file, deps.targetDpi, input.spec);
      // A very detailed page at the pixel cap can still be over the upload limit: render once more
      // with the pixel count scaled down (about 0.8 x limit / size) so the upload is not refused.
      const limit = deps.maxUploadMb * 1024 * 1024;
      if (blob.size > limit) {
        blob = await deps.rasterise(input.design.file, deps.targetDpi * Math.sqrt((0.8 * limit) / blob.size), input.spec);
      }
      const jpg = new File([blob], input.design.file.name.replace(/\.pdf$/i, '') + '.jpg', { type: 'image/jpeg' });
      const failed = await doUpload(jpg);
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
    return { kind: 'degraded', reason: e instanceof Error ? e.message : 'unknown', error: e };
  }
}
