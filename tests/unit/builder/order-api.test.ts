import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postOrder, uploadWithProgress } from '@/components/builder/orderApi';
import { order } from '@/content/ar';
import type { OrderRequest } from '@/lib/types';

/** Minimal XMLHttpRequest double: records the request, then lets the test script the outcome. */
class FakeXhr {
  static sent: FakeXhr[] = [];
  static script: (xhr: FakeXhr) => void = () => undefined;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = undefined;
  responseType = '';
  status = 0;
  responseText = '';
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  aborted = 0;
  onabort: (() => void) | null = null;
  abort() {
    this.aborted++;
    this.onabort?.(); // the real one fires `abort` synchronously
  }
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onload: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
    queueMicrotask(() => FakeXhr.script(this));
  }
  answer(status: number, text: string) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const notJson = (status: number) => new Response('<html>bad gateway</html>', { status });
const png = (bytes = 'abc') => new File([bytes], 'a.png', { type: 'image/png' });
const JSON_POST = (body: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
  signal: expect.any(AbortSignal),
});

beforeEach(() => {
  FakeXhr.sent = [];
  FakeXhr.script = () => undefined;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

describe('postOrder', () => {
  const body: OrderRequest = {
    orderId: 'id-1',
    uploadId: 'u1',
    spec: { shape: 'rect', corners: 'rounded', widthUm: 30_000, heightUm: 30_000 },
    material: 'plastic',
    sheets: 20,
    customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
  };

  it('posts the JSON body to /api/orders and returns the parsed answer', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'low_dpi', message: 'm' }, 422));
    expect(await postOrder(body)).toEqual({ ok: false, error: 'low_dpi', message: 'm' });
    expect(fetchMock.mock.calls).toEqual([['/api/orders', JSON_POST(JSON.stringify(body))]]);
  });

  it('sends the WhatsApp-offers opt-in in the customer block when the body has it', async () => {
    const withOptIn: OrderRequest = { ...body, customer: { ...body.customer, marketingOptIn: true } };
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'low_dpi', message: 'm' }, 422));
    await postOrder(withOptIn);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).customer.marketingOptIn).toBe(true);
  });

  it('throws bad_order_response_<status> when the answer is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(notJson(502));
    await expect(postOrder(body)).rejects.toThrow(new Error('bad_order_response_502'));
  });

  it('lets a network failure through unchanged', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(postOrder(body)).rejects.toThrow(new TypeError('Failed to fetch'));
  });
});

describe('postJson header deadline (75 s)', () => {
  const body = { orderId: 'id-1' } as unknown as OrderRequest;
  /** A fetch that never answers but, like the real one, rejects when its signal aborts. */
  const stalledFetch = () =>
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects with timeout when no answer arrives within 75 s, not before', async () => {
    stalledFetch();
    const p = postOrder(body);
    const seen = p.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(74_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await seen).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer once the headers arrive: a slow body read is never cut', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return json({ ok: false, error: 'low_dpi', message: 'm' }, 422);
    });
    const p = postOrder(body);
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toEqual({ ok: false, error: 'low_dpi', message: 'm' });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(signal?.aborted).toBe(false);
  });

  it('upload start and commit use the same deadline', async () => {
    stalledFetch();
    const p = uploadWithProgress(png(), vi.fn());
    const seen = p.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(75_000);
    expect(await seen).toBe('timeout');
    expect(FakeXhr.sent).toHaveLength(0);
  });
});

describe('uploadWithProgress', () => {
  it('server mode: asks /api/upload/direct, then sends the multipart POST /api/upload', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 4 });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 0 });
      xhr.answer(200, JSON.stringify({ ok: true, uploadId: 'u1', kind: 'png', bytes: 3 }));
    };
    const onProgress = vi.fn();
    const file = png();
    expect(await uploadWithProgress(file, onProgress)).toEqual({ ok: true, uploadId: 'u1', kind: 'png', bytes: 3 });

    expect(fetchMock.mock.calls).toEqual([['/api/upload/direct', JSON_POST('{"size":3,"name":"a.png"}')]]);
    expect(FakeXhr.sent).toHaveLength(1);
    const xhr = FakeXhr.sent[0];
    expect([xhr.method, xhr.url, xhr.responseType, xhr.headers]).toEqual(['POST', '/api/upload', 'text', {}]);
    const form = xhr.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()]).toEqual(['file']);
    expect((form.get('file') as File).name).toBe('a.png');
    expect(onProgress.mock.calls).toEqual([[0.25]]);
  });

  it('server mode: a non-JSON upload answer throws bad_upload_response_<status>', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => xhr.answer(500, '<html>');
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('bad_upload_response_500'));
  });

  it('direct mode: PUTs the file as octet-stream to the signed URL, then commits', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: true, mode: 'direct', uploadId: 'u9', url: 'https://bucket.example/signed?token=t' }))
      .mockResolvedValueOnce(json({ ok: true, uploadId: 'u9', kind: 'png', bytes: 3 }));
    FakeXhr.script = (xhr) => xhr.answer(200, '');
    const file = png();
    expect(await uploadWithProgress(file, vi.fn())).toEqual({ ok: true, uploadId: 'u9', kind: 'png', bytes: 3 });

    const xhr = FakeXhr.sent[0];
    expect([xhr.method, xhr.url, xhr.headers]).toEqual(['PUT', 'https://bucket.example/signed?token=t', { 'content-type': 'application/octet-stream' }]);
    expect(xhr.body).toBe(file);
    expect(fetchMock.mock.calls).toEqual([
      ['/api/upload/direct', JSON_POST('{"size":3,"name":"a.png"}')],
      ['/api/upload/direct/commit', JSON_POST('{"uploadId":"u9","name":"a.png"}')],
    ]);
  });

  it('direct mode: returns the commit answer as is, and throws bad_upload_commit_<status> when it is not JSON', async () => {
    const start = { ok: true, mode: 'direct', uploadId: 'u9', url: 'https://bucket.example/x' };
    FakeXhr.script = (xhr) => xhr.answer(204, '');
    fetchMock.mockResolvedValueOnce(json(start)).mockResolvedValueOnce(json({ ok: false, error: 'corrupt', message: 'm' }, 422));
    expect(await uploadWithProgress(png(), vi.fn())).toEqual({ ok: false, error: 'corrupt', message: 'm' });
    fetchMock.mockResolvedValueOnce(json(start)).mockResolvedValueOnce(notJson(500));
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('bad_upload_commit_500'));
  });

  it.each([413, 400])('direct mode: a %i from the bucket means too_large and skips the commit', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'direct', uploadId: 'u9', url: 'https://bucket.example/x' }));
    FakeXhr.script = (xhr) => xhr.answer(status, 'Payload too large');
    expect(await uploadWithProgress(png(), vi.fn())).toEqual({ ok: false, error: 'too_large', message: order.errors.too_large });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('direct mode: other bucket statuses, and 413 for an empty file, reject with direct_upload_<status>', async () => {
    const start = { ok: true, mode: 'direct', uploadId: 'u9', url: 'https://bucket.example/x' };
    fetchMock.mockResolvedValueOnce(json(start));
    FakeXhr.script = (xhr) => xhr.answer(403, '');
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('direct_upload_403'));
    fetchMock.mockResolvedValueOnce(json(start));
    FakeXhr.script = (xhr) => xhr.answer(413, '');
    await expect(uploadWithProgress(png(''), vi.fn())).rejects.toThrow(new Error('direct_upload_413'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns a refused start as is without uploading, and throws bad_upload_start_<status> when it is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'rate_limited', message: 'm' }, 429));
    expect(await uploadWithProgress(png(), vi.fn())).toEqual({ ok: false, error: 'rate_limited', message: 'm' });
    fetchMock.mockResolvedValueOnce(notJson(500));
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('bad_upload_start_500'));
    expect(FakeXhr.sent).toHaveLength(0);
  });

  describe('upload watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(json({ ok: true, mode: 'server' }));
    });
    afterEach(() => vi.useRealTimers());

    /** Start the upload and wait until the XHR is sent (the start call is a fake-timer-safe microtask chain). */
    async function begin(onProgress = vi.fn()) {
      const outcome: string[] = [];
      uploadWithProgress(png(), onProgress).then(
        (r) => outcome.push(`ok:${JSON.stringify(r)}`),
        (e: Error) => outcome.push(`err:${e.message}`),
      );
      await vi.advanceTimersByTimeAsync(0);
      return { xhr: FakeXhr.sent[0], outcome };
    }
    const progress = (xhr: FakeXhr, loaded: number, total = 1_000_000) => xhr.upload.onprogress?.({ lengthComputable: true, loaded, total });

    it('(a) a stalled upload rejects with timeout after 60 s without progress, and aborts the request', async () => {
      const { xhr, outcome } = await begin();
      progress(xhr, 10);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(outcome).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toEqual(['err:timeout']);
      expect(xhr.aborted).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('(a) an upload that never reports any progress is cut 60 s after send', async () => {
      const { outcome } = await begin();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(outcome).toEqual(['err:timeout']);
    });

    it('(b) a slow but steadily progressing upload is never cut, even over 5 minutes', async () => {
      const { xhr, outcome } = await begin();
      for (let i = 1; i <= 30; i++) {
        await vi.advanceTimersByTimeAsync(10_000); // 300 s in total, a tick every 10 s
        progress(xhr, i * 30_000);
      }
      expect(outcome).toEqual([]);
      expect(xhr.aborted).toBe(0);
      xhr.upload.onload?.();
      xhr.answer(200, JSON.stringify({ ok: true, uploadId: 'u1', kind: 'png', bytes: 3 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toEqual(['ok:{"ok":true,"uploadId":"u1","kind":"png","bytes":3}']);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('(c) once all bytes are sent the answer must come within 45 s', async () => {
      const { xhr, outcome } = await begin();
      progress(xhr, 1_000_000);
      await vi.advanceTimersByTimeAsync(50_000); // would be inside the 60 s stall window
      xhr.upload.onload?.();
      await vi.advanceTimersByTimeAsync(44_999);
      expect(outcome).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toEqual(['err:timeout']);
      expect(xhr.aborted).toBe(1);
    });

    it('(c) an answer inside the response window wins and stops the timer', async () => {
      const { xhr, outcome } = await begin();
      xhr.upload.onload?.();
      await vi.advanceTimersByTimeAsync(44_000);
      xhr.answer(200, JSON.stringify({ ok: true, uploadId: 'u1', kind: 'png', bytes: 3 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(outcome).toHaveLength(1);
      expect(xhr.aborted).toBe(0);
    });

    it('(d) settles exactly once: a late load, error or abort after the timeout changes nothing', async () => {
      const { xhr, outcome } = await begin();
      await vi.advanceTimersByTimeAsync(60_000);
      xhr.answer(200, JSON.stringify({ ok: true, uploadId: 'u1', kind: 'png', bytes: 3 }));
      await vi.advanceTimersByTimeAsync(0);
      xhr.onerror?.();
      await vi.advanceTimersByTimeAsync(0);
      xhr.onabort?.();
      xhr.ontimeout?.();
      expect(outcome).toEqual(['err:timeout']);
    });

    it('(d) a network error clears the timers and a later abort does not settle again', async () => {
      const { xhr, outcome } = await begin();
      xhr.onerror?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
      xhr.onabort?.();
      await vi.advanceTimersByTimeAsync(200_000);
      expect(outcome).toEqual(['err:network']);
    });

    it('an abort from outside rejects with network and clears the timers', async () => {
      const { xhr, outcome } = await begin();
      xhr.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toEqual(['err:network']);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('rejects with network / timeout when the XHR fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => xhr.onerror?.();
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('network'));
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => xhr.ontimeout?.();
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('timeout'));
  });
});
