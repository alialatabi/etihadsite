import { builder, common, fill, order } from '@/content/ar';
import type { OrderRequest } from '@/lib/types';
import {
  submitOrderFlow,
  uploadErrorCopy,
  type AttemptContext,
  type FlowDeps,
  type FlowResult,
  type SubmitExtra,
  type SubmitInput,
} from './submitFlow';

/**
 * The upload → order sequence of a multi-design order (free of React, unit-tested). Every design is uploaded in turn
 * (design 1, then each extra) and ONE order is posted with `designs[]`. A design already uploaded by an earlier try of
 * this order (`ctx`) is not uploaded again. The server names the design an error is about with `designIndex`:
 * `needs_raster` rasterises and re-uploads only that PDF, `upload_missing` re-uploads only that file, and any other
 * error is shown as «التصميم رقم N: …». Without extras this is submitOrderFlow.
 */
export async function submitMultiFlow(input: SubmitInput, ctx: AttemptContext, deps: FlowDeps): Promise<FlowResult> {
  const extras = input.extras ?? [];
  if (extras.length === 0) return submitOrderFlow(input, ctx, deps);

  try {
    const items: SubmitExtra[] = [{ design: input.design, widthUm: input.spec.widthUm, heightUm: input.spec.heightUm }, ...extras];
    const n = items.length;

    const getId = (i: number): string | undefined => (i === 0 ? ctx.uploadId : (ctx.extraUploads?.[i - 1]?.uploadId ?? undefined));
    const isRastered = (i: number): boolean => (i === 0 ? ctx.rastered : ctx.extraUploads?.[i - 1]?.rastered === true);
    const setUpload = (i: number, id: string | undefined, rastered: boolean): void => {
      if (i === 0) {
        ctx.uploadId = id;
        ctx.rastered = rastered;
        return;
      }
      const list = (ctx.extraUploads ??= []);
      while (list.length < i) list.push(null);
      list[i - 1] = id ? { uploadId: id, ...(rastered ? { rastered: true as const } : {}) } : null;
    };

    // One progress bar over all the uploads this call has to make: (finished + current fraction) / planned.
    let finished = 0;
    let planned = items.filter((_, i) => !getId(i)).length;
    const progress = (fraction: number) => deps.onProgress(Math.min(1, (finished + fraction) / Math.max(1, planned)));

    /** Upload `file` as design `i`; a refusal names the design. */
    const upload = async (i: number, file: File, rastered: boolean): Promise<FlowResult | null> => {
      const up = await deps.upload(file, progress);
      if (!up.ok) {
        if (up.error === 'server_error') return { kind: 'degraded', reason: `upload:${up.error}` };
        const message = uploadErrorCopy(deps.maxUploadMb)[up.error] ?? common.errors.generic;
        return { kind: 'error', code: 'upload_error', message: fill(builder.multi.designError, { n: i + 1 }) + message };
      }
      setUpload(i, up.uploadId, rastered);
      finished++;
      deps.remember?.(ctx);
      return null;
    };

    // The body is built from the context on every call: an upload id changes after a rasterise or a re-upload.
    const body = (): OrderRequest => ({
      orderId: ctx.orderId,
      uploadId: ctx.uploadId as string,
      spec: input.spec,
      material: input.material,
      stickers: input.stickers,
      sheets: input.sheets,
      customer: input.customer,
      designs: items.map((it, i) => ({ uploadId: getId(i) as string, widthUm: it.widthUm, heightUm: it.heightUm })),
    });

    if (planned > 0) deps.onPhase('uploading');
    for (let i = 0; i < n; i++) {
      if (getId(i)) continue;
      const failed = await upload(i, items[i].design.file, false);
      if (failed) return failed;
    }

    deps.onPhase('processing');
    let res = await deps.postOrder(body());

    // Each design is repaired at most once per kind; the cap also bounds the loop.
    const missingTried = new Set<number>();
    const rasterTried = new Set<number>();
    for (let guard = 0; guard < 2 * n + 2 && !res.ok; guard++) {
      if (res.error === 'upload_missing') {
        // The server no longer has this design's upload (purged): send that file again, once.
        const i = res.designIndex ?? 0;
        if (i < 0 || i >= n || missingTried.has(i)) break;
        missingTried.add(i);
        if (i === 0) ctx.seeded = false;
        setUpload(i, undefined, false);
        finished = 0;
        planned = 1;
        deps.onPhase('uploading');
        const failed = await upload(i, items[i].design.file, false);
        if (failed) return failed;
      } else if (res.error === 'needs_raster') {
        const i = res.designIndex ?? items.findIndex((it, k) => it.design.kind === 'pdf' && !isRastered(k) && !rasterTried.has(k));
        if (i < 0 || i >= n || rasterTried.has(i) || isRastered(i) || items[i].design.kind !== 'pdf') break;
        rasterTried.add(i);
        const it = items[i];
        const target = { widthUm: it.widthUm, heightUm: it.heightUm };
        let blob = await deps.rasterise(it.design.file, deps.targetDpi, target);
        // A very detailed page at the pixel cap can still be over the upload limit: render once more smaller.
        const limit = deps.maxUploadMb * 1024 * 1024;
        if (blob.size > limit) blob = await deps.rasterise(it.design.file, deps.targetDpi * Math.sqrt((0.8 * limit) / blob.size), target);
        const jpg = new File([blob], it.design.file.name.replace(/\.pdf$/i, '') + '.jpg', { type: 'image/jpeg' });
        finished = 0;
        planned = 1;
        deps.onPhase('uploading');
        const failed = await upload(i, jpg, true);
        if (failed) return failed;
      } else break;
      deps.onPhase('processing');
      res = await deps.postOrder(body());
    }

    if (res.ok) return { kind: 'ok', response: res };
    if (res.error === 'server_error') return { kind: 'degraded', reason: 'order:server_error' };
    let message =
      res.error === 'invalid_quantity' ? builder.quantity.errors.invalid_quantity : (order.errors[res.error] ?? res.message ?? common.errors.generic);
    if (res.designIndex !== undefined && res.designIndex >= 0 && res.designIndex < n) {
      message = fill(builder.multi.designError, { n: res.designIndex + 1 }) + message;
    }
    return { kind: 'error', code: res.error, message };
  } catch (e) {
    return { kind: 'degraded', reason: e instanceof Error ? e.message : 'unknown', error: e };
  }
}
