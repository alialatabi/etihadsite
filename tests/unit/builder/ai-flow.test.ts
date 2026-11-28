import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptedAiLines,
  aiAcceptedSize,
  aiShrinkWarning,
  aiSizeDrifted,
  generateBlock,
  restoredState,
  seedUploadId,
  shapeStepOk,
  type PersistedForm,
} from '@/components/builder/logic';
import {
  addRefs,
  aiBusy,
  aiErrorMessage,
  canRetryAi,
  isAiOffError,
  maxWidthAtSize,
  pngFileFromBase64,
  printableLines,
  resultAcceptedSpec,
  resultDpiStatus,
  resultShown,
  showViewResult,
  textWarning,
  typedLine,
} from '@/components/builder/ai/ai-logic';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { postBrief, postGenerate } from '@/components/builder/ai/api';
import { uploadWithProgress } from '@/components/builder/orderApi';
import { submitOrderFlow, type AttemptContext, type FlowDeps, type SubmitInput } from '@/components/builder/submitFlow';
import { builder } from '@/content/ar';
import { safeLayout } from '@/components/builder/safe';
import { AI_LINE_MAX_CHARS, AI_MAX_LINES } from '@/lib/ai/config';
import { textCapacity } from '@/lib/ai/text-capacity';
import type { OrderResponse, UploadResponse } from '@/lib/types';

/* ───────────────────────── first page ───────────────────────── */

describe('stepOk.shape', () => {
  it('stepOk.shape requires size in ai mode only', () => {
    expect(shapeStepOk({ shape: null, mode: 'upload', sizeOk: true })).toBe(false);
    expect(shapeStepOk({ shape: null, mode: 'ai', sizeOk: true })).toBe(false);
    expect(shapeStepOk({ shape: 'circle', mode: 'upload', sizeOk: false })).toBe(true);
    expect(shapeStepOk({ shape: 'circle', mode: 'ai', sizeOk: false })).toBe(false);
    expect(shapeStepOk({ shape: 'circle', mode: 'ai', sizeOk: true })).toBe(true);
  });
});

describe('generateBlock', () => {
  const base = { shape: 'rect' as const, size: { widthUm: 50_000, heightUm: 30_000 }, sizeOk: true, idea: 'ستيكر قهوة', unavailable: false, busy: false };

  it('lets a complete first page generate', () => {
    expect(generateBlock(base)).toBeNull();
  });

  it('has no ratio limit: a rect longer than 3:1 may generate', () => {
    expect(generateBlock({ ...base, size: { widthUm: 91_000, heightUm: 30_000 } })).toBeNull();
    expect(generateBlock({ ...base, size: { widthUm: 30_000, heightUm: 91_000 } })).toBeNull();
    expect(generateBlock({ ...base, size: { widthUm: 280_000, heightUm: 10_000 } })).toBeNull();
    expect(generateBlock({ ...base, shape: 'custom', size: { widthUm: 91_000, heightUm: 30_000 } })).toBeNull();
  });

  it('needs a shape, a valid size, an idea, and the feature on', () => {
    expect(generateBlock({ ...base, shape: null })).toBe('shape');
    expect(generateBlock({ ...base, sizeOk: false })).toBe('size');
    expect(generateBlock({ ...base, size: null })).toBe('size');
    expect(generateBlock({ ...base, idea: '   ' })).toBe('idea');
    expect(generateBlock({ ...base, unavailable: true })).toBe('unavailable');
    expect(generateBlock({ ...base, busy: true })).toBe('busy');
  });
});

/* ───────────────────────── accept ───────────────────────── */

describe('aiAcceptedSize', () => {
  it('custom accept keeps the longer side at the typed size', () => {
    const box = { widthUm: 50_000, heightUm: 50_000 };
    // Wide subject: width keeps 5 cm, height follows.
    expect(aiAcceptedSize('custom', box, 1000 / 500)).toEqual({ widthUm: 50_000, heightUm: 25_000 });
    // Tall subject: height keeps 5 cm, width follows.
    expect(aiAcceptedSize('custom', box, 400 / 1000)).toEqual({ widthUm: 20_000, heightUm: 50_000 });
    // Square subject.
    expect(aiAcceptedSize('custom', box, 1)).toEqual({ widthUm: 50_000, heightUm: 50_000 });
  });

  it('circle keeps the diameter, rect keeps the width and follows the image ratio', () => {
    expect(aiAcceptedSize('circle', { widthUm: 30_000, heightUm: 30_000 }, 1)).toEqual({ widthUm: 30_000, heightUm: 30_000 });
    expect(aiAcceptedSize('rect', { widthUm: 50_000, heightUm: 30_000 }, 1024 / 608)).toEqual({ widthUm: 50_000, heightUm: 29_688 });
  });
});

describe('aiShrinkWarning', () => {
  const ai = { w: 50_000, h: 30_000 };
  it('shrink warning only below the generated size', () => {
    expect(aiShrinkWarning(null, { widthUm: 10_000, heightUm: 10_000 })).toBe(false);
    expect(aiShrinkWarning(ai, null)).toBe(false);
    expect(aiShrinkWarning(ai, { widthUm: 50_000, heightUm: 30_000 })).toBe(false);
    expect(aiShrinkWarning(ai, { widthUm: 60_000, heightUm: 36_000 })).toBe(false);
    expect(aiShrinkWarning(ai, { widthUm: 49_999, heightUm: 30_000 })).toBe(true);
    expect(aiShrinkWarning(ai, { widthUm: 50_000, heightUm: 29_000 })).toBe(true);
  });
});

/* ───────────────────────── draft ───────────────────────── */

describe('restoredState (AI fields)', () => {
  it('restoredState keeps mode, idea, aiUploadId, aiSizeUm', () => {
    const r = restoredState({
      shape: 'circle',
      mode: 'ai',
      idea: 'ستيكر لمقهى',
      aiUploadId: 'up_123',
      aiFileId: 'file_1',
      aiSizeUm: { w: 30_000, h: 30_000 },
      fileId: 'file_1',
    });
    expect(r.mode).toBe('ai');
    expect(r.idea).toBe('ستيكر لمقهى');
    expect(r.aiUploadId).toBe('up_123');
    expect(r.aiFileId).toBe('file_1');
    expect(r.aiSizeUm).toEqual({ w: 30_000, h: 30_000 });
  });

  it('drops junk AI fields', () => {
    const junk = { mode: 'robot', idea: 7, aiUploadId: '', aiFileId: 'x'.repeat(65), aiSizeUm: { w: -1, h: 'a' } } as unknown as Partial<PersistedForm>;
    const r = restoredState(junk);
    expect(r).toStrictEqual({ fields: r.fields });
  });

  it('caps an over-long idea at 1000 characters', () => {
    expect(restoredState({ idea: 'ا'.repeat(1200) }).idea).toHaveLength(1000);
  });
});

/* ───────────────────────── submit ───────────────────────── */

const okOrder: OrderResponse = { ok: true, orderId: 'o1', displayNo: 'EP-251107-AB3C', summary: {} as never, whatsappUrl: '', notified: { telegram: 'sent' } };
const okUpload = (id: string): UploadResponse => ({ ok: true, uploadId: id, kind: 'png', bytes: 1 });
const input: SubmitInput = {
  design: { kind: 'png', file: new File(['x'], 'ai-design.png', { type: 'image/png' }) } as never,
  spec: { shape: 'circle', widthUm: 30_000, heightUm: 30_000 },
  material: 'paper',
  stickers: 54,
  sheets: 1,
  customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: '' },
};
function deps(over: Partial<FlowDeps> = {}): FlowDeps {
  return {
    upload: vi.fn(async () => okUpload('fresh')),
    postOrder: vi.fn(async () => okOrder),
    rasterise: vi.fn(async () => new Blob(['png'])),
    onPhase: vi.fn(),
    onProgress: vi.fn(),
    targetDpi: 300,
    maxUploadMb: 15,
    ...over,
  };
}

describe('submit with an accepted AI design', () => {
  it('accepted AI design survives reload and submit reuses uploadId', async () => {
    // What a reload brings back: the form names the stored file and the AI upload made from it.
    const r = restoredState({ shape: 'circle', mode: 'ai', fileId: 'f1', aiFileId: 'f1', aiUploadId: 'ai-up' });
    const seed = seedUploadId({ aiUploadId: r.aiUploadId ?? null, aiFileId: r.aiFileId ?? null, fileId: r.fileId ?? null });
    expect(seed).toBe('ai-up');

    const d = deps();
    const ctx: AttemptContext = { orderId: 'o', rastered: false, uploadId: seed, seeded: true };
    const res = await submitOrderFlow(input, ctx, d);
    expect(res.kind).toBe('ok');
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.postOrder).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'ai-up' }));
  });

  it('uploading a file after accepting an AI design clears aiUploadId', async () => {
    // A new file gets a new draft fileId: the AI upload no longer belongs to the design.
    expect(seedUploadId({ aiUploadId: 'ai-up', aiFileId: 'f1', fileId: 'f2' })).toBeUndefined();
    expect(seedUploadId({ aiUploadId: null, aiFileId: null, fileId: 'f2' })).toBeUndefined();
    expect(seedUploadId({ aiUploadId: 'ai-up', aiFileId: 'f1', fileId: null })).toBeUndefined();

    const d = deps();
    const ctx: AttemptContext = { orderId: 'o', rastered: false };
    await submitOrderFlow(input, ctx, d);
    expect(d.upload).toHaveBeenCalledTimes(1);
    expect(d.postOrder).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'fresh' }));
  });

  it('a seeded upload the server no longer has is uploaded again once', async () => {
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'upload_missing', message: '' })
      .mockResolvedValueOnce(okOrder);
    const d = deps({ postOrder });
    const ctx: AttemptContext = { orderId: 'o', rastered: false, uploadId: 'gone', seeded: true };
    const res = await submitOrderFlow(input, ctx, d);
    expect(res.kind).toBe('ok');
    expect(d.upload).toHaveBeenCalledTimes(1);
    expect(postOrder.mock.calls[1][0].uploadId).toBe('fresh');
  });

  it('a degraded submit keeps the finished upload in the context; a new context uploads the new file', async () => {
    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });

    // First try degrades after the upload finished: the context keeps the upload of file a.
    const first: AttemptContext = { orderId: 'o1', rastered: false };
    const degraded = await submitOrderFlow({ ...input, design: { ...input.design, file: a } }, first, deps({ postOrder: vi.fn(async () => { throw new Error('offline'); }) }));
    expect(degraded.kind).toBe('degraded');
    expect(first.uploadId).toBe('fresh');

    // The customer picked another design: a new context, the old upload is not reused.
    const second: AttemptContext = { orderId: 'o2', rastered: false };
    const d = deps({ upload: vi.fn(async () => okUpload('for-b')) });
    await submitOrderFlow({ ...input, design: { ...input.design, file: b } }, second, d);
    expect(d.postOrder).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'for-b', orderId: 'o2' }));
  });

  it('upload_missing without a seed is still an error', async () => {
    const d = deps({ postOrder: vi.fn(async () => ({ ok: false as const, error: 'upload_missing' as const, message: '' })) });
    const res = await submitOrderFlow(input, { orderId: 'o', rastered: false }, d);
    expect(res.kind).toBe('error');
    expect(d.upload).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────── AI helpers ───────────────────────── */

describe('ai helpers', () => {
  const png = (name: string, size = 10, type = 'image/png') => new File([new Uint8Array(size)], name, { type });

  it('addRefs keeps PNG/JPEG only, at most 5, within the size limit, and counts what it left out', () => {
    const a = png('a.png');
    const got = addRefs([a], [png('b.jpg', 10, 'image/jpeg'), png('c.pdf', 10, 'application/pdf'), png('d.webp', 10, 'image/webp'), png('e.JPEG', 10, '')], 100);
    expect(got.files.map((f) => f.name)).toEqual(['a.png', 'b.jpg', 'e.JPEG']);
    expect(got.rejected).toBe(2);
    const many = addRefs([], Array.from({ length: 7 }, (_, i) => png(`${i}.png`)), 100);
    expect(many.files).toHaveLength(5);
    expect(many.rejected).toBe(2);
    expect(addRefs([], [png('big.png', 101)], 100)).toEqual({ files: [], rejected: 1 });
    expect(addRefs([a], [png('ok.png')], 100)).toEqual({ files: [a, expect.any(File)], rejected: 0 });
  });

  it('two quick picks build on each other (the second sees the first)', () => {
    const first = addRefs([], [png('1.png'), png('2.png'), png('3.png')], 100);
    const second = addRefs(first.files, [png('4.png'), png('5.png'), png('6.png')], 100);
    expect(second.files.map((f) => f.name)).toEqual(['1.png', '2.png', '3.png', '4.png', '5.png']);
    expect(second.rejected).toBe(1);
    expect(builder.ai.refRejected).toBe('الصورة لازم تكون PNG أو JPG، ولحد 5 صور.');
  });

  it('while a try runs: no Back, no second generate, and page 1 offers «شوف التصميم»', () => {
    expect(aiBusy('generating', false)).toBe(true);
    expect(aiBusy('idle', true)).toBe(true);
    expect(aiBusy('result', false)).toBe(false);
    expect(aiBusy('reviewing', false)).toBe(false);
    expect(showViewResult('generating', false)).toBe(true);
    expect(showViewResult('result', true)).toBe(true);
    expect(['idle', 'reviewing', 'error'].some((p) => showViewResult(p as never, false))).toBe(false);
    // The page-1 button reads the same busy flag.
    const ready = { shape: 'circle' as const, size: { widthUm: 30_000, heightUm: 30_000 }, sizeOk: true, idea: 'x', unavailable: false };
    expect(generateBlock({ ...ready, busy: aiBusy('generating', false) })).toBe('busy');
    expect(generateBlock({ ...ready, busy: aiBusy('result', false) })).toBeNull();
    expect(builder.ai.viewResult).toBe('شوف التصميم');
  });

  it('pngFileFromBase64 wraps the bytes as ai-design.png', async () => {
    const f = pngFileFromBase64(Buffer.from([137, 80, 78, 71]).toString('base64'));
    expect(f.name).toBe('ai-design.png');
    expect(f.type).toBe('image/png');
    expect([...new Uint8Array(await f.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it('maps error codes to copy, and knows which ones turn the feature off', () => {
    expect(aiErrorMessage('ip_limit')).toBe(builder.ai.errors.ip_limit);
    expect(aiErrorMessage('rate_limited')).toBe(builder.ai.unavailable);
    expect(aiErrorMessage('nonsense' as never)).toBe(builder.ai.errors.failed);
    // A failure on this side never claims the try was not counted.
    expect(aiErrorMessage('network')).toBe('صار خلل بالاتصال. جرّب مرة لخ.');
    expect(aiErrorMessage('failed')).toContain('ما انحسبت المحاولة');
    expect(aiErrorMessage('network')).not.toContain('ما انحسبت');
    expect(['unavailable', 'site_limit', 'blocked'].every((c) => isAiOffError(c as never))).toBe(true);
    expect(['ip_limit', 'failed', 'refused', 'text_too_long'].some((c) => isAiOffError(c as never))).toBe(false);
  });

  it('printableLines trims and drops empty lines', () => {
    expect(printableLines([' قهوة ', '', '   ', 'بغداد'])).toEqual(['قهوة', 'بغداد']);
  });

  it('printableLines cleans a line exactly as the server does (what is confirmed is what is printed)', () => {
    expect(printableLines(['«حلويات»\n<b>', '  a"b\'c`d \t\u0007  e  ', '«»'])).toEqual(['حلويات b', 'abcd e']);
    expect(printableLines(['ا'.repeat(100)])[0]).toHaveLength(60);
  });

  it('typedLine drops the characters that are never printed but keeps spaces while typing', () => {
    expect(typedLine('«قهوة» ')).toBe('قهوة ');
    expect(typedLine('a  b<c>"d"')).toBe('a  bcd');
    expect(typedLine('x\ny')).toBe('x y');
  });
});

/* ───────────────────────── a kept result (A1, A4) ───────────────────────── */

describe('the paid result stays until a new one arrives', () => {
  it('«شوف التصميم» shows while a try runs or a result is kept, whatever the phase', () => {
    expect(showViewResult('reviewing', true)).toBe(true);
    expect(showViewResult('error', true)).toBe(true);
    expect(showViewResult('idle', true)).toBe(true);
    expect(showViewResult('error', false)).toBe(false);
  });

  it('the result shows whenever it exists, except while a new try runs', () => {
    expect(resultShown('result', true)).toBe(true);
    expect(resultShown('error', true)).toBe(true);
    expect(resultShown('reviewing', true)).toBe(true);
    expect(resultShown('idle', true)).toBe(true);
    expect(resultShown('generating', true)).toBe(false);
    expect(resultShown('result', false)).toBe(false);
  });

  it('another try is offered unless the error or the limits rule it out', () => {
    const ok = { off: false, remainingToday: 3, phase: 'error' as const };
    expect(canRetryAi({ ...ok, error: 'failed' })).toBe(true);
    expect(canRetryAi({ ...ok, error: 'refused' })).toBe(true);
    expect(canRetryAi({ ...ok, error: 'network' })).toBe(true);
    for (const e of ['ip_limit', 'text_too_long', 'invalid_request'] as const) expect(canRetryAi({ ...ok, error: e })).toBe(false);
    expect(canRetryAi({ ...ok, off: true, error: 'failed' })).toBe(false);
    expect(canRetryAi({ ...ok, remainingToday: 0, error: 'failed' })).toBe(false);
    expect(canRetryAi({ off: false, remainingToday: null, phase: 'result', error: undefined })).toBe(true);
    // A stale error after «عدّل الفكرة» (phase no longer 'error') does not block a try.
    expect(canRetryAi({ off: false, remainingToday: 2, phase: 'reviewing', error: 'text_too_long' })).toBe(true);
  });

  it('the result screen shows the DPI warning the arrangement step would show (spec 5.7)', () => {
    const q = DEFAULT_SETTINGS.quality;
    const at = (widthUm: number) => ({ pxWidth: 1024, pxHeight: 1024, madeFor: { shape: 'circle' as const, widthUm, heightUm: widthUm } });
    expect(resultDpiStatus(at(170_000), q)).toBe('ok');
    expect(resultDpiStatus(at(180_000), q)).toBe('warn');
    expect(resultDpiStatus(at(370_000), q)).toBe('block');
    // Rect: the width is kept and the height follows the image, as at accept.
    expect(resultDpiStatus({ pxWidth: 1536, pxHeight: 1024, madeFor: { shape: 'rect', widthUm: 250_000, heightUm: 100_000 } }, q)).toBe('ok');
    expect(resultDpiStatus({ pxWidth: 1536, pxHeight: 1024, madeFor: { shape: 'rect', widthUm: 270_000, heightUm: 100_000 } }, q)).toBe('warn');
  });
});

/* ───────────────────────── page 1 rectangle (A6) ───────────────────────── */

describe('aiSizeDrifted', () => {
  it('a size typed freely on page 1 that no longer has the design ratio is caught', () => {
    expect(aiSizeDrifted({ widthUm: 50_000, heightUm: 50_000 }, 1)).toBe(false);
    expect(aiSizeDrifted({ widthUm: 50_000, heightUm: 30_000 }, 1)).toBe(true);
    expect(aiSizeDrifted({ widthUm: 60_000, heightUm: 40_000 }, 1.5)).toBe(false);
    // Rounding of the derived side is not a drift.
    expect(aiSizeDrifted({ widthUm: 33_300, heightUm: 22_100 }, 1.5)).toBe(false);
    expect(aiSizeDrifted(null, 1)).toBe(false);
  });
});

describe('api fetchers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the brief body and returns the JSON answer', async () => {
    const answer = { ok: true, lines: ['قهوة'], fixes: [], visualDescription: 'cup', briefToken: 'a'.repeat(64) };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = { idea: 'قهوة', shape: 'circle' as const, widthUm: 30_000, heightUm: 30_000 };
    await expect(postBrief(body)).resolves.toEqual(answer);
    expect(fetchMock).toHaveBeenCalledWith('/api/design/brief', expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });

  it('a JSON error answer with a non-2xx status is passed through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'ip_limit' }), { status: 429 })));
    await expect(postGenerate({} as never)).resolves.toEqual({ ok: false, error: 'ip_limit' });
  });

  it('a network failure or a non-JSON answer becomes the client-side code network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(postGenerate({} as never)).resolves.toEqual({ ok: false, error: 'network' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 504 })));
    await expect(postBrief({} as never)).resolves.toEqual({ ok: false, error: 'network' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })));
    await expect(postBrief({} as never)).resolves.toEqual({ ok: false, error: 'network' });
  });

  describe('header deadlines', () => {
    /** A fetch that never answers but rejects when its signal aborts, like the real one. */
    const stalled = () =>
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
          }),
      );
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('brief: no answer headers within 75 s becomes {ok:false,error:network}', async () => {
      vi.stubGlobal('fetch', stalled());
      let out: unknown;
      void postBrief({} as never).then((r) => (out = r));
      await vi.advanceTimersByTimeAsync(74_999);
      expect(out).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(out).toEqual({ ok: false, error: 'network' });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('generate: the deadline is 330 s (the route runs up to 300 s: a long sticker is painted in several calls)', async () => {
      vi.stubGlobal('fetch', stalled());
      let out: unknown;
      void postGenerate({} as never).then((r) => (out = r));
      await vi.advanceTimersByTimeAsync(329_999);
      expect(out).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(out).toEqual({ ok: false, error: 'network' });
    });

    it('once the headers are in, a slow body read is not cut', async () => {
      let signal: AbortSignal | undefined;
      const answer = { ok: true, lines: [], fixes: [], visualDescription: 'x', briefToken: 'a'.repeat(64) };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          return new Response(JSON.stringify(answer), { status: 200 });
        }),
      );
      const p = postBrief({} as never);
      await vi.advanceTimersByTimeAsync(0);
      await expect(p).resolves.toEqual(answer);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(signal?.aborted).toBe(false);
    });

    it('a reference upload whose start call stalls ends as an error that useAiDesign maps to network (uploadRefs catch)', async () => {
      vi.stubGlobal('fetch', stalled());
      let out: unknown;
      void uploadWithProgress(new File(['abc'], 'a.png', { type: 'image/png' }), () => {}).then(
        () => (out = 'resolved'),
        (e: Error) => (out = e.message),
      );
      await vi.advanceTimersByTimeAsync(75_000);
      // uploadRefs wraps this call in try/catch and answers 'network' for any rejection
      expect(out).toBe('timeout');
    });
  });
});

/* ───────────────────────── too much text: a warning, never a block ───────────────────────── */

describe('textWarning', () => {
  const BIRTHDAY = ['عيد ميلاد سعيد', 'يا حبيبي', 'محمد', 'عمرك سنتين', 'نحبك هواية', 'ماما وبابا'];
  const HUGE = Array.from({ length: 8 }, () => 'ا'.repeat(60));
  const circle30 = { widthUm: 30_000, heightUm: 30_000 };

  it('is null with no shape, no size, or text that fits', () => {
    expect(textWarning(BIRTHDAY, null, circle30, null)).toBeNull();
    expect(textWarning(BIRTHDAY, 'circle', null, null)).toBeNull();
    expect(textWarning(['حلويات الريم'], 'circle', circle30, null)).toBeNull();
    expect(textWarning([], 'circle', circle30, null)).toBeNull();
    expect(textWarning(['', '   '], 'circle', circle30, null)).toBeNull();
  });

  it('recommends a bigger size when one fits (the size text-capacity finds)', () => {
    const w = textWarning(BIRTHDAY, 'circle', circle30, null);
    expect(w).toEqual({ kind: 'enlarge', sizeUm: textCapacity(BIRTHDAY, 'circle', 30_000, 30_000).minSizeUm });
    expect(w?.kind === 'enlarge' && w.sizeUm > 30_000).toBe(true);
  });

  it('cleans the lines like the print does (empty lines do not count)', () => {
    expect(textWarning([...BIRTHDAY, '  ', ''], 'circle', circle30, null)).toEqual(textWarning(BIRTHDAY, 'circle', circle30, null));
  });

  it('never recommends a size the size step would reject: the max width turns it into "reduce"', () => {
    const min = textCapacity(BIRTHDAY, 'circle', 30_000, 30_000).minSizeUm as number;
    expect(textWarning(BIRTHDAY, 'circle', circle30, min)).toEqual({ kind: 'enlarge', sizeUm: min });
    expect(textWarning(BIRTHDAY, 'circle', circle30, min - 1)).toEqual({ kind: 'reduce' });
  });

  it('reads a max-width function only when the text does not fit, and gives the same result as the number', () => {
    const min = textCapacity(BIRTHDAY, 'circle', 30_000, 30_000).minSizeUm as number;
    const fits = vi.fn(() => min);
    expect(textWarning(['حلويات الريم'], 'circle', circle30, fits)).toBeNull();
    expect(fits).not.toHaveBeenCalled();
    const tooBig = vi.fn(() => min - 1);
    expect(textWarning(BIRTHDAY, 'circle', circle30, tooBig)).toEqual(textWarning(BIRTHDAY, 'circle', circle30, min - 1));
    expect(tooBig).toHaveBeenCalledTimes(1);
    const ok = vi.fn(() => min);
    expect(textWarning(BIRTHDAY, 'circle', circle30, ok)).toEqual({ kind: 'enlarge', sizeUm: min });
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('says reduce when no size up to the shop maximum fits', () => {
    expect(textCapacity(HUGE, 'circle', 30_000, 30_000).minSizeUm).toBeNull();
    expect(textWarning(HUGE, 'circle', circle30, null)).toEqual({ kind: 'reduce' });
  });
});

describe('resultAcceptedSpec', () => {
  it('is the size aiAcceptedSize gives at the decoded ratio (a circle stays round)', () => {
    const madeFor = { shape: 'circle' as const, widthUm: 40_000, heightUm: 40_000 };
    expect(resultAcceptedSpec({ pxWidth: 1000, pxHeight: 1000, madeFor })).toEqual({ shape: 'circle', widthUm: 40_000, heightUm: 40_000 });
    const rect = { shape: 'rect' as const, widthUm: 60_000, heightUm: 30_000 };
    expect(resultAcceptedSpec({ pxWidth: 2000, pxHeight: 1000, madeFor: rect })).toEqual({ shape: 'rect', widthUm: 60_000, heightUm: 30_000 });
  });
  it('is null while the pixel size is unknown', () => {
    expect(resultAcceptedSpec({ pxWidth: 0, pxHeight: 0, madeFor: { shape: 'circle', widthUm: 40_000, heightUm: 40_000 } })).toBeNull();
  });
});

describe('restoredState aiLines', () => {
  it('keeps valid lines', () => {
    expect(restoredState({ aiLines: ['حلويات الريم', '07801112233'] }).aiLines).toEqual(['حلويات الريم', '07801112233']);
  });
  it('keeps exactly AI_MAX_LINES lines, drops more than that', () => {
    expect(restoredState({ aiLines: Array.from({ length: AI_MAX_LINES }, () => 'س') }).aiLines).toHaveLength(AI_MAX_LINES);
    expect(restoredState({ aiLines: Array.from({ length: AI_MAX_LINES + 1 }, () => 'س') }).aiLines).toBeUndefined();
  });
  it('drops anything that is not an array of strings', () => {
    for (const junk of ['abc', 7, {}, [], ['ok', 3], [null], [['x']]]) {
      expect(restoredState({ aiLines: junk } as unknown as Partial<PersistedForm>).aiLines).toBeUndefined();
    }
  });
  it('cuts a too-long line to AI_LINE_MAX_CHARS', () => {
    const r = restoredState({ aiLines: ['ا'.repeat(AI_LINE_MAX_CHARS + 20), 'قصير'] });
    expect(r.aiLines?.[0]).toHaveLength(AI_LINE_MAX_CHARS);
    expect(r.aiLines?.[1]).toBe('قصير');
  });
});

describe('acceptedAiLines', () => {
  const ok = { mode: 'ai' as const, aiLines: ['أ'], aiFileId: 'f1', fileId: 'f1' };
  it('gives the lines only while the design is the accepted AI file in AI mode', () => {
    expect(acceptedAiLines(ok)).toEqual(['أ']);
    expect(acceptedAiLines({ ...ok, mode: 'upload' })).toBeNull();
    expect(acceptedAiLines({ ...ok, fileId: 'other' })).toBeNull();
    expect(acceptedAiLines({ ...ok, fileId: null })).toBeNull();
    expect(acceptedAiLines({ ...ok, aiFileId: null })).toBeNull();
    expect(acceptedAiLines({ ...ok, aiLines: null })).toBeNull();
    expect(acceptedAiLines({ ...ok, aiLines: [] })).toBeNull();
  });
});

describe('maxWidthAtSize', () => {
  const layout = DEFAULT_SETTINGS.layout;
  it('is the widest width that still lays out at the size’s own ratio', () => {
    for (const size of [{ widthUm: 40_000, heightUm: 120_000 }, { widthUm: 120_000, heightUm: 40_000 }]) {
      const cap = maxWidthAtSize('rect', 'rounded', size, layout) as number;
      expect(cap).toBeGreaterThan(0);
      const at = (w: number) => safeLayout({ shape: 'rect', corners: 'rounded', widthUm: w, heightUm: Math.round((w * size.heightUm) / size.widthUm) }, layout).ok;
      expect(at(cap)).toBe(true);
      expect(at(cap + 2_000)).toBe(false);
    }
  });
  it('is null without a shape or size', () => {
    expect(maxWidthAtSize(null, 'rounded', { widthUm: 1, heightUm: 1 }, layout)).toBeNull();
    expect(maxWidthAtSize('circle', 'rounded', null, layout)).toBeNull();
  });
});
