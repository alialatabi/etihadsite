import { describe, expect, it, vi } from 'vitest';

import { submitOrderFlow, type AttemptContext, type FlowDeps, type SubmitInput } from '@/components/builder/submitFlow';
import { builder, common, fill, order } from '@/content/ar';
import type { OrderError, OrderResponse, UploadResponse } from '@/lib/types';

const okOrder: OrderResponse = {
  ok: true,
  orderId: 'o1',
  displayNo: 'EP-251107-AB3C',
  summary: {} as never,
  whatsappUrl: '',
  notified: { telegram: 'sent' },
};
const okUpload = (id: string): UploadResponse => ({ ok: true, uploadId: id, kind: 'pdf', bytes: 1 });

const input = (name = 'a.pdf', type = 'application/pdf'): SubmitInput => ({
  design: { kind: type === 'application/pdf' ? 'pdf' : 'png', file: new File(['x'], name, { type }) } as never,
  spec: { shape: 'rect', corners: 'rounded', widthUm: 30_000, heightUm: 30_000 },
  material: 'plastic',
  stickers: 1050,
  sheets: 20,
  customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
});

function deps(over: Partial<FlowDeps>): FlowDeps {
  return {
    upload: vi.fn(async () => okUpload('u1')),
    postOrder: vi.fn(async () => okOrder),
    rasterise: vi.fn(async () => new Blob(['png'])),
    onPhase: vi.fn(),
    onProgress: vi.fn(),
    targetDpi: 300,
    maxUploadMb: 15,
    ...over,
  };
}

describe('submitOrderFlow', () => {
  it('uploads then posts the contract body', async () => {
    const d = deps({});
    const ctx: AttemptContext = { orderId: 'id-1', rastered: false };
    const r = await submitOrderFlow(input(), ctx, d);
    expect(r.kind).toBe('ok');
    expect(d.postOrder).toHaveBeenCalledWith({
      orderId: 'id-1',
      uploadId: 'u1',
      spec: input().spec,
      material: 'plastic',
      stickers: 1050,
      sheets: 20,
      customer: input().customer,
    });
  });

  it('retries needs_raster once with the rasterised PNG', async () => {
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'needs_raster', message: '' })
      .mockResolvedValueOnce(okOrder);
    const upload = vi.fn<FlowDeps['upload']>().mockResolvedValueOnce(okUpload('u1')).mockResolvedValueOnce(okUpload('u2'));
    const d = deps({ postOrder, upload });
    const r = await submitOrderFlow(input(), { orderId: 'id', rastered: false }, d);
    expect(r.kind).toBe('ok');
    expect(d.rasterise).toHaveBeenCalledWith(expect.any(File), 300);
    expect((upload.mock.calls[1][0] as File).name).toBe('a.png');
    expect(postOrder.mock.calls[1][0].uploadId).toBe('u2');
  });

  it('does not loop on a second needs_raster', async () => {
    const postOrder = vi.fn<FlowDeps['postOrder']>().mockResolvedValue({ ok: false, error: 'needs_raster', message: '' });
    const r = await submitOrderFlow(input(), { orderId: 'id', rastered: false }, deps({ postOrder }));
    expect(r.kind).toBe('error');
    expect(postOrder).toHaveBeenCalledTimes(2);
  });

  it('maps order errors to Arabic copy', async () => {
    const postOrder = vi.fn<FlowDeps['postOrder']>().mockResolvedValue({ ok: false, error: 'low_dpi', message: '' });
    const r = await submitOrderFlow(input(), { orderId: 'id', rastered: false }, deps({ postOrder }));
    expect(r).toMatchObject({ kind: 'error', code: 'low_dpi' });
  });

  it('degrades on network failure and keeps the finished upload for retry', async () => {
    const postOrder = vi.fn<FlowDeps['postOrder']>().mockRejectedValue(new Error('network'));
    const ctx: AttemptContext = { orderId: 'id', rastered: false };
    const r = await submitOrderFlow(input(), ctx, deps({ postOrder }));
    expect(r.kind).toBe('degraded');
    expect(ctx.uploadId).toBe('u1');
  });

  it('degrades on upload server_error', async () => {
    const upload = vi.fn<FlowDeps['upload']>().mockResolvedValue({ ok: false, error: 'server_error', message: '' });
    const r = await submitOrderFlow(input(), { orderId: 'id', rastered: false }, deps({ upload }));
    expect(r.kind).toBe('degraded');
  });
});

describe('submitOrderFlow result branches', () => {
  const ctx = (): AttemptContext => ({ orderId: 'id', rastered: false });
  const uploadFail = (error: string) =>
    vi.fn<FlowDeps['upload']>().mockResolvedValue({ ok: false, error, message: 'server text' } as UploadResponse);
  const orderFail = (error: string, message?: string) =>
    vi.fn<FlowDeps['postOrder']>().mockResolvedValue({ ok: false, error, message } as OrderResponse);

  it('upload too_large gives the builder upload copy', async () => {
    const d = deps({ upload: uploadFail('too_large') });
    const c = ctx();
    const r = await submitOrderFlow(input(), c, d);
    expect(r).toEqual({ kind: 'error', code: 'upload_error', message: fill(builder.upload.errors.too_large, { mb: 15 }) });
    expect(d.postOrder).not.toHaveBeenCalled();
    expect(c.uploadId).toBeUndefined();
  });

  it('upload unsupported_type and corrupt give the order copy', async () => {
    const a = await submitOrderFlow(input(), ctx(), deps({ upload: uploadFail('unsupported_type') }));
    expect(a).toEqual({ kind: 'error', code: 'upload_error', message: order.errors.unsupported_type });
    const b = await submitOrderFlow(input(), ctx(), deps({ upload: uploadFail('corrupt') }));
    expect(b).toEqual({ kind: 'error', code: 'upload_error', message: order.errors.corrupt });
  });

  it('upload rate_limited gives common.errors.rateLimited', async () => {
    const r = await submitOrderFlow(input(), ctx(), deps({ upload: uploadFail('rate_limited') }));
    expect(r).toEqual({ kind: 'error', code: 'upload_error', message: common.errors.rateLimited });
  });

  it('an unknown upload code gives common.errors.generic', async () => {
    const r = await submitOrderFlow(input(), ctx(), deps({ upload: uploadFail('brand_new_code') }));
    expect(r).toEqual({ kind: 'error', code: 'upload_error', message: common.errors.generic });
  });

  it('upload server_error degrades with reason upload:server_error', async () => {
    const d = deps({ upload: uploadFail('server_error') });
    const r = await submitOrderFlow(input(), ctx(), d);
    expect(r).toEqual({ kind: 'degraded', reason: 'upload:server_error' });
    expect(d.postOrder).not.toHaveBeenCalled();
  });

  it('order invalid_quantity gives the builder quantity copy', async () => {
    const r = await submitOrderFlow(input(), ctx(), deps({ postOrder: orderFail('invalid_quantity', 'server text') }));
    expect(r).toEqual({ kind: 'error', code: 'invalid_quantity', message: builder.quantity.errors.invalid_quantity });
  });

  const otherOrderCodes: OrderError[] = [
    'invalid_request',
    'upload_missing',
    'invalid_phone',
    'too_small',
    'too_big_for_page',
    'ratio_extreme',
    'low_dpi',
    'no_alpha',
    'unsupported_type',
    'corrupt',
    'encrypted',
    'needs_raster',
    'rate_limited',
    'captcha_failed',
  ];
  it.each(otherOrderCodes)('order %s gives order.errors[code]', async (code) => {
    const r = await submitOrderFlow(input(), ctx(), deps({ postOrder: orderFail(code, 'server text') }));
    expect(r).toEqual({ kind: 'error', code, message: order.errors[code] });
    expect(order.errors[code]).toBeTruthy();
  });

  it('an unknown order code falls back to the server message, then to common.errors.generic', async () => {
    const a = await submitOrderFlow(input(), ctx(), deps({ postOrder: orderFail('brand_new_code', 'server text') }));
    expect(a).toEqual({ kind: 'error', code: 'brand_new_code', message: 'server text' });
    const b = await submitOrderFlow(input(), ctx(), deps({ postOrder: orderFail('brand_new_code') }));
    expect(b).toEqual({ kind: 'error', code: 'brand_new_code', message: common.errors.generic });
  });

  it('order server_error degrades with reason order:server_error', async () => {
    const c = ctx();
    const r = await submitOrderFlow(input(), c, deps({ postOrder: orderFail('server_error', 'server text') }));
    expect(r).toEqual({ kind: 'degraded', reason: 'order:server_error' });
    expect(c.uploadId).toBe('u1');
  });

  it('a thrown Error degrades with its message as the reason', async () => {
    const postOrder = vi.fn<FlowDeps['postOrder']>().mockRejectedValue(new Error('bad_order_response_502'));
    expect(await submitOrderFlow(input(), ctx(), deps({ postOrder }))).toEqual({ kind: 'degraded', reason: 'bad_order_response_502' });
    const upload = vi.fn<FlowDeps['upload']>().mockRejectedValue(new Error('network'));
    expect(await submitOrderFlow(input(), ctx(), deps({ upload }))).toEqual({ kind: 'degraded', reason: 'network' });
    const rasterise = vi.fn<FlowDeps['rasterise']>().mockRejectedValue(new Error('toBlob failed'));
    const needsRaster = orderFail('needs_raster', '');
    expect(await submitOrderFlow(input(), ctx(), deps({ postOrder: needsRaster, rasterise }))).toEqual({ kind: 'degraded', reason: 'toBlob failed' });
  });

  it('a thrown non-Error degrades with reason unknown', async () => {
    const upload = vi.fn<FlowDeps['upload']>().mockRejectedValue('boom');
    expect(await submitOrderFlow(input(), ctx(), deps({ upload }))).toEqual({ kind: 'degraded', reason: 'unknown' });
  });

  it('reports the phases in order and skips the upload when the context already has one', async () => {
    const postOrder = vi
      .fn<FlowDeps['postOrder']>()
      .mockResolvedValueOnce({ ok: false, error: 'needs_raster', message: '' })
      .mockResolvedValueOnce(okOrder);
    const d = deps({ postOrder });
    const c = ctx();
    expect(await submitOrderFlow(input(), c, d)).toEqual({ kind: 'ok', response: okOrder });
    expect(vi.mocked(d.onPhase).mock.calls.map((a) => a[0])).toEqual(['uploading', 'processing', 'uploading', 'processing']);
    expect(c).toEqual({ orderId: 'id', uploadId: 'u1', rastered: true });

    const again = deps({});
    expect((await submitOrderFlow(input(), { orderId: 'id', uploadId: 'kept', rastered: false }, again)).kind).toBe('ok');
    expect(again.upload).not.toHaveBeenCalled();
    expect(vi.mocked(again.onPhase).mock.calls.map((a) => a[0])).toEqual(['processing']);
    expect(vi.mocked(again.postOrder).mock.calls[0][0].uploadId).toBe('kept');
  });

  it('does not rasterise a non-PDF design on needs_raster', async () => {
    const d = deps({ postOrder: orderFail('needs_raster', '') });
    const r = await submitOrderFlow(input('a.png', 'image/png'), ctx(), d);
    expect(r).toEqual({ kind: 'error', code: 'needs_raster', message: order.errors.needs_raster });
    expect(d.rasterise).not.toHaveBeenCalled();
    expect(d.postOrder).toHaveBeenCalledTimes(1);
  });
});
