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
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
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
const JSON_POST = (body: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

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

  it('throws bad_order_response_<status> when the answer is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(notJson(502));
    await expect(postOrder(body)).rejects.toThrow(new Error('bad_order_response_502'));
  });

  it('lets a network failure through unchanged', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(postOrder(body)).rejects.toThrow(new TypeError('Failed to fetch'));
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

  it('rejects with network / timeout when the XHR fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => xhr.onerror?.();
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('network'));
    fetchMock.mockResolvedValueOnce(json({ ok: true, mode: 'server' }));
    FakeXhr.script = (xhr) => xhr.ontimeout?.();
    await expect(uploadWithProgress(png(), vi.fn())).rejects.toThrow(new Error('timeout'));
  });
});
