import { describe, expect, it, vi } from 'vitest';

import {
  ATTEMPT_KEY,
  ATTEMPT_TTL_MS,
  attemptFingerprint,
  clearStoredAttempt,
  keepAttemptAfterError,
  loadStoredAttempt,
  parseStoredAttempt,
  rememberUpload,
  resolveAttempt,
  saveStoredAttempt,
  serialiseAttempt,
  type KeptAttempt,
} from '@/components/builder/submitAttempt';
import { submitOrderFlow, type AttemptContext, type FlowDeps, type SubmitInput } from '@/components/builder/submitFlow';
import type { OrderResponse, UploadResponse } from '@/lib/types';

const input = (over: Partial<SubmitInput> = {}, file = new File(['x'], 'a.png', { type: 'image/png', lastModified: 1000 })): SubmitInput => ({
  design: { kind: 'png', file } as never,
  spec: { shape: 'rect', corners: 'rounded', widthUm: 30_000, heightUm: 30_000 },
  material: 'plastic',
  stickers: 1050,
  sheets: 20,
  customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
  ...over,
});

let n = 0;
const newId = () => `new${++n}`;
const kept = (ctx: AttemptContext, i: SubmitInput, seed?: string): KeptAttempt => ({ ctx, fp: attemptFingerprint(i, seed) });

function fakeStore(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('attemptFingerprint', () => {
  it('is stable for the same input and reacts to every order field', () => {
    const a = input();
    expect(attemptFingerprint(input()).order).toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(input({ stickers: 1100 })).order).not.toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(input({ sheets: 21 })).order).not.toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(input({ material: 'paper' as never })).order).not.toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(input({ spec: { ...a.spec, widthUm: 40_000 } })).order).not.toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(input({ customer: { ...a.customer, district: 'z' } })).order).not.toBe(attemptFingerprint(a).order);
  });

  it('ignores the WhatsApp-offers box: ticking it must not change the order id across a reload', () => {
    const a = input();
    const ticked = input({ customer: { ...a.customer, marketingOptIn: true } });
    expect(attemptFingerprint(ticked).order).toBe(attemptFingerprint(a).order);
    expect(attemptFingerprint(ticked).order).toBe(attemptFingerprint(input({ customer: { ...a.customer, marketingOptIn: false } })).order);
  });

  it('design part reacts to file name, size, lastModified and seed only', () => {
    const base = attemptFingerprint(input());
    const f = (name: string, body: string, lm: number) => new File([body], name, { lastModified: lm });
    expect(attemptFingerprint(input({}, f('b.png', 'x', 1000))).design).not.toBe(base.design);
    expect(attemptFingerprint(input({}, f('a.png', 'xx', 1000))).design).not.toBe(base.design);
    expect(attemptFingerprint(input({}, f('a.png', 'x', 2000))).design).not.toBe(base.design);
    expect(attemptFingerprint(input(), 'seed1').design).not.toBe(base.design);
    expect(attemptFingerprint(input({ stickers: 5 })).design).toBe(base.design);
  });

  it('ignores the rasterised JPG: the fingerprint depends on input.design.file only', () => {
    const i = input();
    const before = attemptFingerprint(i);
    // needs_raster swaps ctx.uploadId, never input.design.file
    expect(attemptFingerprint(i)).toEqual(before);
  });
});

describe('resolveAttempt', () => {
  it('keeps the same context for the same order', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'u1', rastered: false };
    expect(resolveAttempt({ kept: kept(ctx, i), stored: null, fp: attemptFingerprint(i), newId })).toBe(ctx);
  });

  it('gives a fresh id but keeps the upload when only the details changed', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'u1', rastered: false };
    const j = input({ stickers: 2000 });
    const r = resolveAttempt({ kept: kept(ctx, i), stored: null, fp: attemptFingerprint(j), newId });
    expect(r.orderId).not.toBe('o1');
    expect(r.uploadId).toBe('u1');
    expect(r.rastered).toBe(false);
  });

  it('drops the upload when the design changed', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'u1', rastered: false };
    const j = input({}, new File(['yy'], 'other.png', { lastModified: 5 }));
    const r = resolveAttempt({ kept: kept(ctx, i), stored: null, fp: attemptFingerprint(j), newId });
    expect(r.orderId).not.toBe('o1');
    expect(r.uploadId).toBeUndefined();
  });

  it('a new seed replaces the old upload; a dropped seed removes it', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'seed1', rastered: false, seeded: true };
    const toNew = resolveAttempt({ kept: kept(ctx, i, 'seed1'), stored: null, fp: attemptFingerprint(i, 'seed2'), seedUploadId: 'seed2', newId });
    expect(toNew).toMatchObject({ uploadId: 'seed2', seeded: true, rastered: false });
    expect(toNew.orderId).not.toBe('o1');
    const toNone = resolveAttempt({ kept: kept(ctx, i, 'seed1'), stored: null, fp: attemptFingerprint(i), newId });
    expect(toNone.uploadId).toBeUndefined();
    expect(toNone.seeded).toBeUndefined();
  });

  it('keeps the seeded flag when the same seeded design is kept', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'seed1', rastered: false, seeded: true };
    const r = resolveAttempt({ kept: kept(ctx, i, 'seed1'), stored: null, fp: attemptFingerprint(input({ stickers: 7 }), 'seed1'), seedUploadId: 'seed1', newId });
    expect(r).toMatchObject({ uploadId: 'seed1', seeded: true });
  });

  it('does not reuse a rasterised JPG for a changed order', () => {
    const i = input();
    const ctx: AttemptContext = { orderId: 'o1', uploadId: 'jpg1', rastered: true };
    const r = resolveAttempt({ kept: kept(ctx, i), stored: null, fp: attemptFingerprint(input({ stickers: 7 })), newId });
    expect(r.uploadId).toBeUndefined();
    expect(r.rastered).toBe(false);
  });

  it('after a reload reuses the stored id only when the fingerprint matches', () => {
    const i = input();
    const fp = attemptFingerprint(i);
    const same = resolveAttempt({ kept: null, stored: { orderId: 'saved1', fingerprint: fp.order }, fp, newId });
    expect(same).toEqual({ orderId: 'saved1', rastered: false });
    const diff = resolveAttempt({ kept: null, stored: { orderId: 'saved1', fingerprint: 'other' }, fp, newId });
    expect(diff.orderId).not.toBe('saved1');
    const none = resolveAttempt({ kept: null, stored: null, fp, newId });
    expect(none.orderId).toMatch(/^new/);
  });

  it('seeds a fresh context with the AI upload', () => {
    const i = input();
    const r = resolveAttempt({ kept: null, stored: null, fp: attemptFingerprint(i, 's'), seedUploadId: 's', newId });
    expect(r).toMatchObject({ uploadId: 's', seeded: true, rastered: false });
  });
});

describe('keepAttemptAfterError', () => {
  it('keeps only rate_limited', () => {
    expect(keepAttemptAfterError('rate_limited')).toBe(true);
    for (const c of ['invalid_quantity', 'upload_error', 'upload_missing', 'needs_raster']) expect(keepAttemptAfterError(c)).toBe(false);
  });
});

describe('stored attempt', () => {
  it('round-trips and expires', () => {
    const s = serialiseAttempt('o1', 'fp', 1000);
    expect(parseStoredAttempt(s, 1000 + 5)).toEqual({ orderId: 'o1', fingerprint: 'fp' });
    expect(parseStoredAttempt(s, 1000 + ATTEMPT_TTL_MS + 1)).toBeNull();
  });

  it('rejects junk', () => {
    const junk = [
      null,
      undefined,
      '',
      'nope',
      '{}',
      '[]',
      '{"v":2,"orderId":"a","fingerprint":"b","savedAt":1}',
      '{"v":1,"orderId":"","fingerprint":"b","savedAt":1}',
      '{"v":1,"orderId":"a","fingerprint":"b"}',
    ];
    for (const raw of junk) expect(parseStoredAttempt(raw, 1)).toBeNull();
  });

  it('saves under the new key, loads and clears', () => {
    const st = fakeStore();
    saveStoredAttempt('o1', 'fp', 10, st);
    expect(st.m.has(ATTEMPT_KEY)).toBe(true);
    expect(ATTEMPT_KEY).toBe('ub:order-attempt:v1');
    expect(loadStoredAttempt(11, st)).toEqual({ orderId: 'o1', fingerprint: 'fp' });
    clearStoredAttempt(st);
    expect(loadStoredAttempt(11, st)).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => saveStoredAttempt('o', 'f', 1, boom)).not.toThrow();
    expect(loadStoredAttempt(1, boom)).toBeNull();
    expect(() => clearStoredAttempt(boom)).not.toThrow();
    expect(loadStoredAttempt(1, null)).toBeNull();
  });
});

describe('reload after the order was saved (ORDER-REPLAY-1 with IDEM-4)', () => {
  const okOrder: OrderResponse = { ok: true, orderId: 'o1', displayNo: 'EP-251107-AB3C', summary: {} as never, whatsappUrl: '', notified: { telegram: 'sent' } };
  let uploads = 0;
  /** The server side in miniature: a saved order is replayed only for the upload it was saved with. */
  function server() {
    const saved = new Map<string, string>();
    const upload = vi.fn(async (): Promise<UploadResponse> => ({ ok: true, uploadId: `up${++uploads}`, kind: 'png', bytes: 1 }));
    const postOrder = vi.fn(async (b: { orderId: string; uploadId: string }): Promise<OrderResponse> => {
      const had = saved.get(b.orderId);
      if (had === undefined) {
        saved.set(b.orderId, b.uploadId);
        return okOrder;
      }
      return had === b.uploadId ? okOrder : ({ ok: false, error: 'invalid_request' } as OrderResponse);
    });
    return { upload, postOrder };
  }
  const flowDeps = (srv: ReturnType<typeof server>, store: ReturnType<typeof fakeStore>, ctx: AttemptContext, fp: string, lostAnswer: boolean): FlowDeps => ({
    upload: rememberUpload(srv.upload, ctx, fp, store),
    postOrder: lostAnswer
      ? async (b) => {
          await srv.postOrder(b as never);
          throw new Error('network lost the answer');
        }
      : (b) => srv.postOrder(b as never),
    rasterise: vi.fn(async () => new Blob(['jpg'])),
    onPhase: vi.fn(),
    onProgress: vi.fn(),
    targetDpi: 300,
    maxUploadMb: 15,
  });

  it('a retry after a reload sends the same upload id and gets the saved order', async () => {
    const srv = server();
    const store = fakeStore();
    const i = input();
    const fp = attemptFingerprint(i);
    // First try: the order is saved, the answer is lost.
    const ctx1 = resolveAttempt({ kept: null, stored: loadStoredAttempt(Date.now(), store), fp, newId });
    saveStoredAttempt(ctx1.orderId, fp.order, Date.now(), store, ctx1);
    const r1 = await submitOrderFlow(i, ctx1, flowDeps(srv, store, ctx1, fp.order, true));
    expect(r1.kind).toBe('degraded');
    // Reload: nothing in memory, only sessionStorage.
    const ctx2 = resolveAttempt({ kept: null, stored: loadStoredAttempt(Date.now(), store), fp, newId });
    expect(ctx2.orderId).toBe(ctx1.orderId);
    saveStoredAttempt(ctx2.orderId, fp.order, Date.now(), store, ctx2);
    const uploadsBefore = srv.upload.mock.calls.length;
    const r2 = await submitOrderFlow(i, ctx2, flowDeps(srv, store, ctx2, fp.order, false));
    expect(r2.kind).toBe('ok');
    expect(srv.upload.mock.calls.length).toBe(uploadsBefore);
  });

  it('the rasterised JPG of a PDF is remembered the same way', async () => {
    const store = fakeStore();
    const i = input();
    const fp = attemptFingerprint(i);
    const ctx: AttemptContext = { orderId: 'o9', rastered: true };
    await rememberUpload(async () => ({ ok: true as const, uploadId: 'jpg1' }), ctx, fp.order, store)();
    const stored = loadStoredAttempt(Date.now(), store);
    expect(stored).toEqual({ orderId: 'o9', fingerprint: fp.order, uploadId: 'jpg1', rastered: true });
    expect(resolveAttempt({ kept: null, stored, fp, newId })).toMatchObject({ orderId: 'o9', uploadId: 'jpg1', rastered: true });
  });

  it('a failed upload is not remembered; an old record without an upload still loads', () => {
    const store = fakeStore();
    const ctx: AttemptContext = { orderId: 'o9', rastered: false };
    void rememberUpload(async () => ({ ok: false as const }), ctx, 'fp', store)();
    expect(store.m.size).toBe(0);
    expect(parseStoredAttempt('{"v":1,"orderId":"a","fingerprint":"b","savedAt":1}', 1)).toEqual({ orderId: 'a', fingerprint: 'b' });
    expect(parseStoredAttempt('{"v":1,"orderId":"a","fingerprint":"b","savedAt":1,"uploadId":7}', 1)).toEqual({ orderId: 'a', fingerprint: 'b' });
  });
});
