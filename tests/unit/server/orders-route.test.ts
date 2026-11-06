import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { OrderResponse, ShopSettings } from '@/lib/types';
import { setupEnv } from './helpers';

const normaliseArtwork = vi.fn();
const buildSheetPdf = vi.fn();
const notifyShop = vi.fn();

vi.mock('@/lib/design/normalise.server', async (orig) => ({
  ...(await orig<typeof import('@/lib/design/normalise.server')>()),
  normaliseArtwork: (...a: unknown[]) => normaliseArtwork(...a),
}));
vi.mock('@/lib/pdf/build-sheet', () => ({ buildSheetPdf: (...a: unknown[]) => buildSheetPdf(...a) }));
vi.mock('@/lib/notify', () => ({ notifyShop: (...a: unknown[]) => notifyShop(...a) }));
vi.mock('@/lib/order-text', () => ({
  orderSummaryText: (s: { displayNo: string }) => `SUMMARY ${s.displayNo}`,
  shapeLabel: () => 'x',
  sizeLabel: () => 'y',
}));
vi.mock('@/lib/parse/phone', () => ({
  normalisePhone: (p: string) => {
    const d = p.replace(/\D/g, '').replace(/^0+/, '').replace(/^964/, '');
    return /^7\d{9}$/.test(d) ? `964${d}` : null;
  },
  whatsappUrl: (d: string, t?: string) => `https://wa.me/${d}${t ? `?text=${encodeURIComponent(t)}` : ''}`,
}));
vi.mock('@/lib/pricing', () => ({
  findOffer: (id: string, s: ShopSettings) => s.offers.find((o) => o.id === id && o.enabled) ?? null,
  priceFor: (o: { sheets: number; priceIqd: number | null }, count: number, s: ShopSettings) => {
    const offerPriceIqd = s.pricesPublished && o.priceIqd !== null ? o.priceIqd : null;
    const totalIqd = offerPriceIqd === null ? null : offerPriceIqd + s.deliveryFeeIqd;
    const totalStickers = o.sheets * count;
    return {
      offerPriceIqd,
      deliveryFeeIqd: s.deliveryFeeIqd,
      totalIqd,
      totalStickers,
      perStickerIqd: totalIqd === null ? null : Math.round(totalIqd / totalStickers),
    };
  },
  formatIqd: (n: number) => String(n),
}));

import { POST } from '@/app/api/orders/route';
import { getStorage } from '@/lib/storage';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function body(over: Record<string, unknown> = {}) {
  return {
    orderId: 'order-aaaaaaaaaaaaaaaaaa',
    uploadId: 'upload-aaaaaaaaaaaaaaaa',
    spec: { shape: 'circle', widthUm: 30000, heightUm: 30000 },
    offerId: 'offer-20',
    customer: { name: 'علي', phone: '07701234567', governorate: 'بغداد', district: 'الكرادة', landmark: 'قرب الجسر' },
    ...over,
  };
}

function call(b: unknown, ip = '9.9.9.9') {
  return POST(
    new Request('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(b),
    }),
  );
}

async function json(res: Response): Promise<OrderResponse> {
  return (await res.json()) as OrderResponse;
}

beforeEach(async () => {
  setupEnv();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  normaliseArtwork.mockReset().mockResolvedValue({
    ok: true,
    kind: 'png',
    pxWidth: 900,
    pxHeight: 900,
    artwork: { kind: 'raster', bytes: PNG, mime: 'image/png', pxWidth: 354, pxHeight: 354, hasAlpha: true, effectiveDpi: 300 },
  });
  buildSheetPdf.mockReset().mockResolvedValue({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), report: {} });
  notifyShop.mockReset().mockResolvedValue({ telegram: 'sent' });
  const storage = getStorage();
  await storage.saveUpload('upload-aaaaaaaaaaaaaaaa', PNG, {
    mime: 'image/png',
    originalName: 'logo.png',
    bytes: PNG.length,
    createdAt: new Date().toISOString(),
  });
  await storage.saveSettings({
    ...DEFAULT_SETTINGS,
    whatsapp: '9647709999999',
    pricesPublished: true,
    offers: [{ id: 'offer-20', sheets: 20, priceIqd: 25000, enabled: true }],
  });
});

describe('POST /api/orders', () => {
  it('creates an order with the price recomputed from settings', async () => {
    // A hostile client smuggles in its own price; it must be ignored.
    const res = await call(body({ priceIqd: 1, totalIqd: 1, offer: { priceIqd: 1 } }));
    expect(res.status).toBe(200);
    const r = await json(res);
    if (!r.ok) throw new Error('expected ok');
    expect(r.displayNo).toMatch(/^EP-\d{6}-[A-Z2-9]{4}$/);
    expect(r.summary.offerPriceIqd).toBe(25000);
    expect(r.summary.totalIqd).toBe(30000);
    expect(r.summary.sheets).toBe(20);
    expect(r.summary.countPerSheet).toBeGreaterThan(0);
    expect(r.notified.telegram).toBe('sent');
    expect(r.whatsappUrl).toContain('https://wa.me/9647709999999?text=');
    expect(decodeURIComponent(r.whatsappUrl)).toContain(`SUMMARY ${r.displayNo}`);

    const stored = await getStorage().getOrder('order-aaaaaaaaaaaaaaaaaa');
    expect(stored?.status).toBe('new');
    expect(stored?.customer.phone).toBe('9647701234567');
    expect(stored?.files).toEqual({ designPath: 'uploads/upload-aaaaaaaaaaaaaaaa.bin', pdfPath: 'orders/order-aaaaaaaaaaaaaaaaaa.pdf' });
    expect(await getStorage().readFile(stored!.files.pdfPath)).not.toBeNull();
    const fileName = notifyShop.mock.calls[0][2] as string;
    expect(fileName).toBe(`${r.displayNo}_circle-30x30mm_x20.pdf`);
  });

  it('is idempotent on orderId', async () => {
    const first = await json(await call(body()));
    const second = await json(await call(body()));
    if (!first.ok || !second.ok) throw new Error('expected ok');
    expect(second.displayNo).toBe(first.displayNo);
    expect(buildSheetPdf).toHaveBeenCalledTimes(1);
    expect(notifyShop).toHaveBeenCalledTimes(1);
  });

  it('returns an empty whatsappUrl when the shop has no WhatsApp', async () => {
    await getStorage().saveSettings({ ...DEFAULT_SETTINGS, offers: [{ id: 'offer-20', sheets: 20, priceIqd: null, enabled: true }] });
    const r = await json(await call(body()));
    if (!r.ok) throw new Error('expected ok');
    expect(r.whatsappUrl).toBe('');
    expect(r.summary.totalIqd).toBeNull();
  });

  it('maps validation failures to error codes', async () => {
    const bad = await json(await call(body({ customer: { ...body().customer, phone: '12345' } })));
    expect(bad).toMatchObject({ ok: false, error: 'invalid_phone' });

    const offer = await call(body({ orderId: 'order-bbbbbbbbbbbbbbbbbb', offerId: 'nope' }));
    expect(await json(offer)).toMatchObject({ ok: false, error: 'invalid_offer' });

    const up = await call(body({ orderId: 'order-cccccccccccccccccc', uploadId: 'upload-zzzzzzzzzzzzzzzz' }));
    expect(await json(up)).toMatchObject({ ok: false, error: 'upload_missing' });

    const tooBig = await call(body({ orderId: 'order-dddddddddddddddddd', spec: { shape: 'rect', corners: 'sharp', widthUm: 300000, heightUm: 300000 } }));
    expect(await json(tooBig)).toMatchObject({ ok: false, error: 'too_big_for_page' });

    const invalid = await call({ nonsense: true });
    expect(invalid.status).toBe(400);
    expect(await json(invalid)).toMatchObject({ ok: false, error: 'invalid_request' });

    normaliseArtwork.mockResolvedValueOnce({ ok: false, error: 'needs_raster' });
    const nr = await call(body({ orderId: 'order-eeeeeeeeeeeeeeeeee' }));
    expect(await json(nr)).toMatchObject({ ok: false, error: 'needs_raster' });
    expect(await getStorage().getOrder('order-eeeeeeeeeeeeeeeeee')).toBeNull();
  });

  it('persists the order even when notification fails', async () => {
    notifyShop.mockResolvedValue({ telegram: 'failed', error: 'boom' });
    const r = await json(await call(body()));
    if (!r.ok) throw new Error('expected ok');
    expect(r.notified.telegram).toBe('failed');
    expect((await getStorage().getOrder('order-aaaaaaaaaaaaaaaaaa'))?.notified.telegram).toBe('failed');

    notifyShop.mockRejectedValue(new Error('threw'));
    const r2 = await json(await call(body({ orderId: 'order-ffffffffffffffffff' })));
    expect(r2.ok).toBe(true);
    expect((await getStorage().getOrder('order-ffffffffffffffffff'))?.notified.telegram).toBe('failed');
  });

  it('returns server_error when a sibling throws, and rate limits per IP', async () => {
    buildSheetPdf.mockRejectedValueOnce(new Error('pdf exploded'));
    const res = await call(body());
    expect(res.status).toBe(500);
    expect(await json(res)).toMatchObject({ ok: false, error: 'server_error' });

    for (let i = 0; i < 5; i++) await call(body({ orderId: `order-limit-${i}-aaaaaaaa` }), '7.7.7.7');
    const limited = await call(body({ orderId: 'order-limit-9-aaaaaaaa' }), '7.7.7.7');
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ ok: false, error: 'rate_limited' });
  });
});
