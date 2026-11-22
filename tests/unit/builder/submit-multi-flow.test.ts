/**
 * The multi-design submit: every design uploaded in turn, ONE order posted with designs[], a retry that does not upload
 * finished files again, and errors that name a design (designIndex) repairing only that design.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_DESIGNS } from '@/config/defaults';
import {
  attemptFingerprint,
  parseStoredAttempt,
  resolveAttempt,
  saveStoredAttempt,
  serialiseAttempt,
  loadStoredAttempt,
  type KeptAttempt,
} from '@/components/builder/submitAttempt';
import { submitOrderFlow, type AttemptContext, type FlowDeps, type SubmitInput } from '@/components/builder/submitFlow';
import { submitMultiFlow } from '@/components/builder/submitMultiFlow';
import { builder, fill, order } from '@/content/ar';
import type { OrderResponse, UploadResponse } from '@/lib/types';

const okOrder: OrderResponse = {
  ok: true,
  orderId: 'o1',
  displayNo: 'EP-251107-AB3C',
  summary: {} as never,
  whatsappUrl: '',
  notified: { telegram: 'sent' },
};
const okUpload = (id: string): UploadResponse => ({ ok: true, uploadId: id, kind: 'png', bytes: 1 });

const png = (name: string, modified = 1) => ({ kind: 'png', file: new File(['x'], name, { type: 'image/png', lastModified: modified }) }) as never;
const pdf = (name: string) => ({ kind: 'pdf', file: new File(['x'], name, { type: 'application/pdf', lastModified: 1 }) }) as never;

function multiInput(over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    design: png('one.png'),
    spec: { shape: 'rect', corners: 'rounded', widthUm: 30_000, heightUm: 30_000 },
    material: 'paper',
    stickers: 600,
    sheets: 10,
    customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
    extras: [
      { design: png('two.png'), widthUm: 40_000, heightUm: 20_000 },
      { design: png('three.png'), widthUm: 25_000, heightUm: 25_000 },
    ],
    ...over,
  };
}

/** Uploads answer u1, u2, u3 … in call order. */
function counterUpload() {
  let i = 0;
  return vi.fn<FlowDeps['upload']>(async () => okUpload(`u${++i}`));
}

function deps(over: Partial<FlowDeps> = {}): FlowDeps {
  return {
    upload: counterUpload(),
    postOrder: vi.fn(async () => okOrder),
    rasterise: vi.fn(async () => new Blob(['jpg'])),
    onPhase: vi.fn(),
    onProgress: vi.fn(),
    targetDpi: 300,
    maxUploadMb: 15,
    ...over,
  };
}

const ctxOf = (over: Partial<AttemptContext> = {}): AttemptContext => ({ orderId: 'id-1', rastered: false, ...over });

describe('submitMultiFlow', () => {
  it('uploads every design in order, then posts ONE order with designs[] (designs[0] is the spec design)', async () => {
    const d = deps();
    const ctx = ctxOf();
    const r = await submitMultiFlow(multiInput(), ctx, d);
    expect(r.kind).toBe('ok');
    expect((d.upload as ReturnType<typeof counterUpload>).mock.calls.map((c) => (c[0] as File).name)).toEqual(['one.png', 'two.png', 'three.png']);
    expect(d.postOrder).toHaveBeenCalledTimes(1);
    expect(d.postOrder).toHaveBeenCalledWith({
      orderId: 'id-1',
      uploadId: 'u1',
      spec: multiInput().spec,
      material: 'paper',
      stickers: 600,
      sheets: 10,
      customer: multiInput().customer,
      designs: [
        { uploadId: 'u1', widthUm: 30_000, heightUm: 30_000 },
        { uploadId: 'u2', widthUm: 40_000, heightUm: 20_000 },
        { uploadId: 'u3', widthUm: 25_000, heightUm: 25_000 },
      ],
    });
    // every upload id is kept in the context for a retry
    expect(ctx.uploadId).toBe('u1');
    expect(ctx.extraUploads).toEqual([{ uploadId: 'u2' }, { uploadId: 'u3' }]);
  });

  it('without extras it is the single flow (no designs key)', async () => {
    const d = deps();
    const r = await submitMultiFlow(multiInput({ extras: undefined }), ctxOf(), d);
    expect(r.kind).toBe('ok');
    const body = (d.postOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('designs' in body).toBe(false);
  });

  it('the single-design flow does not know extras: its body has no designs key', async () => {
    const d = deps();
    await submitOrderFlow(multiInput({ extras: undefined }), ctxOf(), d);
    expect(Object.keys((d.postOrder as ReturnType<typeof vi.fn>).mock.calls[0][0])).toEqual(['orderId', 'uploadId', 'spec', 'material', 'stickers', 'sheets', 'customer']);
  });

  it('progress runs over all the uploads (not 0..1 for each file), and the phase starts once', async () => {
    const progress: number[] = [];
    const upload = vi.fn<FlowDeps['upload']>(async (_f, onProgress) => {
      onProgress(0.5);
      onProgress(1);
      return okUpload(`u${progress.length}`);
    });
    const d = deps({ upload, onProgress: (f) => progress.push(f) });
    await submitMultiFlow(multiInput(), ctxOf(), d);
    // three uploads: (0+.5)/3, (0+1)/3, (1+.5)/3, ... (2+1)/3
    expect(progress[0]).toBeCloseTo(0.5 / 3);
    expect(progress[1]).toBeCloseTo(1 / 3);
    expect(progress[2]).toBeCloseTo(1.5 / 3);
    expect(progress[5]).toBeCloseTo(1);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
    const phases = (d.onPhase as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(phases).toEqual(['uploading', 'processing']);
  });

  it('a retry reuses the finished uploads: only the missing ones are uploaded', async () => {
    const upload = vi.fn<FlowDeps['upload']>().mockResolvedValueOnce(okUpload('u1')).mockResolvedValueOnce(okUpload('u2')).mockRejectedValueOnce(new Error('network'));
    const ctx = ctxOf();
    const first = await submitMultiFlow(multiInput(), ctx, deps({ upload }));
    expect(first.kind).toBe('degraded'); // the third upload failed
    expect(ctx.uploadId).toBe('u1');
    expect(ctx.extraUploads).toEqual([{ uploadId: 'u2' }]);

    const upload2 = vi.fn<FlowDeps['upload']>().mockResolvedValueOnce(okUpload('u3'));
    const d2 = deps({ upload: upload2 });
    const second = await submitMultiFlow(multiInput(), ctx, d2);
    expect(second.kind).toBe('ok');
    expect(upload2).toHaveBeenCalledTimes(1);
    expect((upload2.mock.calls[0][0] as File).name).toBe('three.png');
    expect((d2.postOrder as ReturnType<typeof vi.fn>).mock.calls[0][0].designs.map((x: { uploadId: string }) => x.uploadId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('with every upload done nothing is uploaded again (a post that failed is just posted again)', async () => {
    const ctx = ctxOf({ uploadId: 'a', extraUploads: [{ uploadId: 'b' }, { uploadId: 'c' }] });
    const d = deps();
    const r = await submitMultiFlow(multiInput(), ctx, d);
    expect(r.kind).toBe('ok');
    expect(d.upload).not.toHaveBeenCalled();
    expect((d.postOrder as ReturnType<typeof vi.fn>).mock.calls[0][0].designs.map((x: { uploadId: string }) => x.uploadId)).toEqual(['a', 'b', 'c']);
  });

  it('remembers all upload ids after every upload (so a reload keeps them)', async () => {
    const seen: string[] = [];
    const d = deps({ remember: (c) => seen.push(JSON.stringify([c.uploadId, c.extraUploads])) });
    await submitMultiFlow(multiInput(), ctxOf(), d);
    expect(seen).toEqual([
      JSON.stringify(['u1', undefined]),
      JSON.stringify(['u1', [{ uploadId: 'u2' }]]),
      JSON.stringify(['u1', [{ uploadId: 'u2' }, { uploadId: 'u3' }]]),
    ]);
  });

  it('an upload refusal names the design', async () => {
    const upload = vi.fn<FlowDeps['upload']>().mockResolvedValueOnce(okUpload('u1')).mockResolvedValueOnce({ ok: false, error: 'unsafe', message: '' });
    const r = await submitMultiFlow(multiInput(), ctxOf(), deps({ upload }));
    expect(r).toEqual({ kind: 'error', code: 'upload_error', message: fill(builder.multi.designError, { n: 2 }) + order.errors.unsafe });
  });

  it('needs_raster with a designIndex rasterises and re-uploads ONLY that PDF, at its own size', async () => {
    const input = multiInput({
      design: png('one.png'),
      extras: [
        { design: pdf('two.pdf'), widthUm: 40_000, heightUm: 20_000 },
        { design: pdf('three.pdf'), widthUm: 25_000, heightUm: 25_000 },
      ],
    });
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'needs_raster', message: '', designIndex: 2 })
      .mockResolvedValueOnce(okOrder);
    const rasterise = vi.fn<FlowDeps['rasterise']>(async () => new Blob(['jpg']));
    const upload = counterUpload();
    const ctx = ctxOf();
    const r = await submitMultiFlow(input, ctx, deps({ postOrder, rasterise, upload }));
    expect(r.kind).toBe('ok');
    expect(rasterise).toHaveBeenCalledTimes(1);
    expect((rasterise.mock.calls[0][0] as File).name).toBe('three.pdf');
    expect(rasterise.mock.calls[0][2]).toEqual({ widthUm: 25_000, heightUm: 25_000 });
    // 3 uploads + 1 re-upload of design 3 as a JPG
    expect(upload).toHaveBeenCalledTimes(4);
    const jpg = upload.mock.calls[3][0] as File;
    expect([jpg.name, jpg.type]).toEqual(['three.jpg', 'image/jpeg']);
    const ids = postOrder.mock.calls[1][0].designs!.map((x) => x.uploadId);
    expect(ids).toEqual(['u1', 'u2', 'u4']); // designs 1 and 2 keep their uploads
    expect(ctx.extraUploads).toEqual([{ uploadId: 'u2' }, { uploadId: 'u4', rastered: true }]);
  });

  it('needs_raster for design 1 rasterises design 1 (ctx.rastered), and each PDF only once', async () => {
    const input = multiInput({ design: pdf('one.pdf'), extras: [{ design: png('two.png'), widthUm: 40_000, heightUm: 20_000 }] });
    const postOrder = vi.fn<FlowDeps['postOrder']>(async () => ({ ok: false, error: 'needs_raster', message: '', designIndex: 0 }) as OrderResponse);
    const rasterise = vi.fn<FlowDeps['rasterise']>(async () => new Blob(['jpg']));
    const ctx = ctxOf();
    const r = await submitMultiFlow(input, ctx, deps({ postOrder, rasterise }));
    expect(rasterise).toHaveBeenCalledTimes(1); // not again on the second needs_raster
    expect(r.kind).toBe('error');
    expect(ctx.rastered).toBe(true);
  });

  it('needs_raster without an index goes to the first PDF not rastered yet', async () => {
    const input = multiInput({ design: png('one.png'), extras: [{ design: png('two.png'), widthUm: 1, heightUm: 1 }, { design: pdf('three.pdf'), widthUm: 25_000, heightUm: 25_000 }] });
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'needs_raster', message: '' })
      .mockResolvedValueOnce(okOrder);
    const rasterise = vi.fn<FlowDeps['rasterise']>(async () => new Blob(['jpg']));
    await submitMultiFlow(input, ctxOf(), deps({ postOrder, rasterise }));
    expect((rasterise.mock.calls[0][0] as File).name).toBe('three.pdf');
  });

  it('upload_missing with a designIndex uploads only that file again, once', async () => {
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'upload_missing', message: '', designIndex: 1 })
      .mockResolvedValueOnce(okOrder);
    const upload = counterUpload();
    const r = await submitMultiFlow(multiInput(), ctxOf({ uploadId: 'old1', extraUploads: [{ uploadId: 'old2' }, { uploadId: 'old3' }] }), deps({ postOrder, upload }));
    expect(r.kind).toBe('ok');
    expect(upload).toHaveBeenCalledTimes(1);
    expect((upload.mock.calls[0][0] as File).name).toBe('two.png');
    expect(postOrder.mock.calls[1][0].designs!.map((x) => x.uploadId)).toEqual(['old1', 'u1', 'old3']);

    // the same design missing again is an error, not a loop
    const again = vi.fn<FlowDeps['postOrder']>(async () => ({ ok: false, error: 'upload_missing', message: '', designIndex: 1 }) as OrderResponse);
    const up2 = counterUpload();
    const r2 = await submitMultiFlow(multiInput(), ctxOf({ uploadId: 'a', extraUploads: [{ uploadId: 'b' }, { uploadId: 'c' }] }), deps({ postOrder: again, upload: up2 }));
    expect(up2).toHaveBeenCalledTimes(1);
    expect(again).toHaveBeenCalledTimes(2);
    expect(r2.kind).toBe('error');
  });

  it('another error with a designIndex is shown as «التصميم رقم N: …»', async () => {
    const postOrder = vi.fn<FlowDeps['postOrder']>(async () => ({ ok: false, error: 'low_dpi', message: 'x', designIndex: 2 }) as OrderResponse);
    const r = await submitMultiFlow(multiInput(), ctxOf(), deps({ postOrder }));
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.code).toBe('low_dpi');
      expect(r.message).toBe(fill(builder.multi.designError, { n: 3 }) + (order.errors.low_dpi));
    }
    // without an index the message is the plain one
    const plain = vi.fn<FlowDeps['postOrder']>(async () => ({ ok: false, error: 'low_dpi', message: 'x' }) as OrderResponse);
    const r2 = await submitMultiFlow(multiInput(), ctxOf(), deps({ postOrder: plain }));
    if (r2.kind === 'error') expect(r2.message).toBe(order.errors.low_dpi);
  });

  it('a server error degrades; a thrown error degrades', async () => {
    const down = await submitMultiFlow(multiInput(), ctxOf(), deps({ postOrder: async () => ({ ok: false, error: 'server_error', message: '' }) }));
    expect(down).toEqual({ kind: 'degraded', reason: 'order:server_error' });
    const thrown = await submitMultiFlow(multiInput(), ctxOf(), deps({ postOrder: async () => { throw new Error('boom'); } }));
    expect(thrown).toMatchObject({ kind: 'degraded', reason: 'boom' });
  });
});

describe('the attempt of a multi-design order', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  let n = 0;
  const newId = () => `new${++n}`;

  it('the fingerprint of a single-design order is unchanged, a multi one also stands for the extras and their sizes', () => {
    const single = multiInput({ extras: undefined });
    const fpSingle = attemptFingerprint(single);
    expect(fpSingle.design).toBe(JSON.stringify(['one.png', 1, 1, null]));
    expect(JSON.parse(fpSingle.order)).toHaveLength(6);

    const m = multiInput();
    const fp = attemptFingerprint(m);
    expect(fp.design).not.toBe(fpSingle.design);
    expect(JSON.parse(fp.order)).toHaveLength(7);
    // another size for design 2 is another order, the same files
    const resized = multiInput({ extras: [{ ...m.extras![0], widthUm: 50_000 }, m.extras![1]] });
    expect(attemptFingerprint(resized).order).not.toBe(fp.order);
    expect(attemptFingerprint(resized).design).toBe(fp.design);
    // another file is another design
    const other = multiInput({ extras: [{ design: png('zzz.png'), widthUm: 40_000, heightUm: 20_000 }, m.extras![1]] });
    expect(attemptFingerprint(other).design).not.toBe(fp.design);
  });

  it('serialise / parse keep every upload id in multi mode and add nothing in single mode', () => {
    const single = serialiseAttempt('o', 'fp', 1, { uploadId: 'u1', rastered: false });
    expect(single).toBe(JSON.stringify({ v: 1, orderId: 'o', fingerprint: 'fp', savedAt: 1, uploadId: 'u1' }));
    const raw = serialiseAttempt('o', 'fp', 1, { uploadId: 'u1', extraUploads: [{ uploadId: 'u2' }, { uploadId: 'u3', rastered: true }] });
    expect(parseStoredAttempt(raw, 1)).toEqual({
      orderId: 'o',
      fingerprint: 'fp',
      uploadId: 'u1',
      extraUploads: [{ uploadId: 'u2' }, { uploadId: 'u3', rastered: true }],
    });
    // saved up to the first gap only; junk entries are cut
    expect(JSON.parse(serialiseAttempt('o', 'fp', 1, { uploadId: 'u1', extraUploads: [{ uploadId: 'u2' }, null, { uploadId: 'u4' }] })).extraUploads).toEqual([{ uploadId: 'u2' }]);
    expect(parseStoredAttempt(JSON.stringify({ v: 1, orderId: 'o', fingerprint: 'fp', savedAt: 1, uploadId: 'u1', extraUploads: [{ uploadId: 5 }] }), 1)?.extraUploads).toBeUndefined();
    const huge = Array.from({ length: 30 }, (_, i) => ({ uploadId: `x${i}` }));
    expect(parseStoredAttempt(JSON.stringify({ v: 1, orderId: 'o', fingerprint: 'fp', savedAt: 1, uploadId: 'u1', extraUploads: huge }), 1)?.extraUploads).toHaveLength(MAX_DESIGNS - 1);
  });

  it('after a reload the stored attempt resumes with ALL upload ids, so nothing finished is uploaded again', async () => {
    const s = store();
    const input = multiInput();
    const fp = attemptFingerprint(input);
    // a first try that uploaded everything, then lost the answer
    const ctx1 = resolveAttempt({ kept: null, stored: null, fp, newId });
    const d1 = deps({ postOrder: async () => { throw new Error('lost'); }, remember: (c) => saveStoredAttempt(c.orderId, fp.order, 1, s, c) });
    await submitMultiFlow(input, ctx1, d1);
    expect(s.m.size).toBe(1);

    // the page reloads: nothing in memory, the stored attempt is read
    const stored = loadStoredAttempt(1, s);
    const ctx2 = resolveAttempt({ kept: null, stored, fp, newId });
    expect(ctx2.orderId).toBe(ctx1.orderId);
    expect([ctx2.uploadId, ctx2.extraUploads]).toEqual(['u1', [{ uploadId: 'u2' }, { uploadId: 'u3' }]]);
    const d2 = deps();
    const r = await submitMultiFlow(input, ctx2, d2);
    expect(r.kind).toBe('ok');
    expect(d2.upload).not.toHaveBeenCalled();
  });

  it('an order the customer changed gets a new id but keeps the uploads of the same files (not a rasterised JPG)', () => {
    const input = multiInput();
    const ctx: AttemptContext = { orderId: 'old', uploadId: 'a', rastered: false, extraUploads: [{ uploadId: 'b' }, { uploadId: 'c', rastered: true }] };
    const kept: KeptAttempt = { ctx, fp: attemptFingerprint(input) };
    const changed = multiInput({ stickers: 700 });
    const next = resolveAttempt({ kept, stored: null, fp: attemptFingerprint(changed), newId });
    expect(next.orderId).not.toBe('old');
    expect(next.uploadId).toBe('a');
    expect(next.extraUploads).toEqual([{ uploadId: 'b' }, null]); // the JPG was drawn for the old size
    // other files: nothing carries over
    const swapped = multiInput({ extras: [{ design: png('new.png'), widthUm: 1, heightUm: 1 }] });
    const fresh = resolveAttempt({ kept, stored: null, fp: attemptFingerprint(swapped), newId });
    expect(fresh.uploadId).toBeUndefined();
    expect(fresh.extraUploads).toBeUndefined();
  });
});
