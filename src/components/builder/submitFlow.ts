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
  /**
   * Multi-design orders only: designs 2..N, each with its own size (design 1 is `design` / `spec`). Absent on a
   * single-design order, which then runs submitOrderFlow exactly as before; present, submitMultiFlow runs.
   */
  extras?: SubmitExtra[];
}

/** One extra design of a multi-design order: the decoded design and the size ordered for it (µm; a circle has equal sides). */
export interface SubmitExtra {
  design: DesignSource;
  widthUm: number;
  heightUm: number;
}

/** The upload of one extra design kept in the attempt (`rastered`: it is the JPG of a PDF). */
export interface ExtraUpload {
  uploadId: string;
  rastered?: true;
}

/** Mutable per-attempt context: keeps the idempotency key (and finished upload) across retries. */
export interface AttemptContext {
  orderId: string;
  uploadId?: string;
  rastered: boolean;
  /** `uploadId` came from an accepted AI design (not this attempt's upload): if the server no longer has it, upload the file once. */
  seeded?: boolean;
  /**
   * Multi-design orders only: the finished uploads of designs 2..N (index i is design i + 2; null = not uploaded).
   * `uploadId` / `rastered` above stay design 1's. A retry of the same order reuses every one of them.
   */
  extraUploads?: (ExtraUpload | null)[];
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
  /** Multi-design flow only: called after every finished upload so the attempt (all upload ids) can be saved. */
  remember?: (ctx: AttemptContext) => void;
}

/** Copy for an upload the customer can fix ('server_error' degrades instead). */
export const uploadErrorCopy = (maxUploadMb: number): Record<Exclude<UploadError, 'server_error'>, string> => ({
  too_large: fill(builder.upload.errors.too_large, { mb: maxUploadMb }),
  unsupported_type: order.errors.unsupported_type,
  corrupt: order.errors.corrupt,
  unsafe: order.errors.unsafe,
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
