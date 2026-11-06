import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/design/decode.client', () => ({ rasterisePdfPage: vi.fn(), decodeDesign: vi.fn() }));

import { submitOrderFlow, type AttemptContext, type FlowDeps, type SubmitInput } from '@/components/builder/useSubmitOrder';
import type { OrderResponse, UploadResponse } from '@/lib/types';

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
  offerId: 'offer-20',
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
      offerId: 'offer-20',
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
