/** Admin order list and detail for multi-design orders (and the «مفرغ» badge on a single one). No JSX here (the glob is *.test.ts). */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderRecord } from '@/lib/types';

let orders: OrderRecord[] = [];
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => undefined }));
vi.mock('@/lib/storage', () => ({
  getStorage: () => ({ listOrders: async () => orders, getOrder: async (id: string) => orders.find((o) => o.orderId === id) ?? null }),
}));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({ retentionDays: 3650 }) }));
vi.mock('@/components/admin/SheetPdfPreview', () => ({ SheetPdfPreview: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/app/admin/orders/[orderId]/StatusForm', () => ({ StatusForm: () => null }));

import OrdersPage from '@/app/admin/page';
import OrderDetailPage from '@/app/admin/orders/[orderId]/page';
import { admin } from '@/content/ar';

const base = {
  displayNo: 'EP-261122-ABCD',
  createdAt: new Date().toISOString(),
  status: 'new',
  spec: { shape: 'circle', widthUm: 30000, heightUm: 30000 },
  price: { material: 'paper', sheets: 20, unitBaseIqd: null, discountPercent: 0, unitPriceIqd: null, subtotalIqd: null, deliveryFeeIqd: 5000, totalIqd: null, totalStickers: 360, perStickerIqd: null },
  customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
  notified: { telegram: 'skipped' },
} as const;

const single = (kind: 'png' | 'jpeg'): OrderRecord =>
  ({
    ...base,
    orderId: 'order-single-00001',
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0 },
    design: { kind, originalName: 'single.png', bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300 },
    files: { designPath: 'uploads/single.bin', pdfPath: 'orders/single.pdf' },
  }) as unknown as OrderRecord;

const multi: OrderRecord = {
  ...base,
  orderId: 'order-multi-000001',
  layout: { cols: 6, rows: 1, countPerSheet: 18, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0, designCount: 3, perDesign: 6 },
  design: { kind: 'png', originalName: 'one.png', bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300, cutOut: true },
  designs: [
    { kind: 'png', originalName: 'one.png', bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300, widthUm: 30000, heightUm: 30000, cutOut: true },
    { kind: 'jpeg', originalName: 'two.jpg', bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 410, widthUm: 25000, heightUm: 25000 },
    { kind: 'pdf', originalName: 'three.pdf', bytes: 3, pxWidth: 10, pxHeight: 10, widthUm: 40000, heightUm: 40000 },
  ],
  files: { designPath: 'uploads/one.bin', pdfPath: 'orders/multi.pdf', designPaths: ['uploads/one.bin', 'uploads/two.bin', 'uploads/three.bin'] },
} as unknown as OrderRecord;

const detail = async (o: OrderRecord) => {
  orders = [o];
  return renderToStaticMarkup(await OrderDetailPage({ params: Promise.resolve({ orderId: o.orderId }), searchParams: Promise.resolve({}) }));
};

describe('admin order list', () => {
  it('shows «N تصاميم» for a multi order and the size for a single one', async () => {
    orders = [multi];
    const m = renderToStaticMarkup(await OrdersPage());
    expect(m).toContain('تصاميم');
    expect(m).not.toContain('3 × 3 سم');
    orders = [single('jpeg')];
    expect(renderToStaticMarkup(await OrdersPage())).toContain('3 × 3 سم');
  });
});

describe('admin order detail', () => {
  it('lists every design with its file, size, DPI, badge and download link', async () => {
    const html = await detail(multi);
    expect(html).toContain('/api/admin/files/order-multi-000001/design-1');
    expect(html).toContain('/api/admin/files/order-multi-000001/design-2');
    expect(html).toContain('/api/admin/files/order-multi-000001/design-3');
    expect(html).not.toContain('/api/admin/files/order-multi-000001/design"');
    for (const name of ['one.png', 'two.jpg', 'three.pdf']) expect(html).toContain(name);
    expect(html).toContain('2.5 × 2.5 سم');
    expect(html).toContain('410');
    expect(html).toContain(admin.detail.perDesign);
    // design 1 «مفرغ», 2 and 3 «غير مفرغ»
    expect((html.match(new RegExp(`>${admin.detail.cutOut}<`, 'g')) ?? []).length).toBe(1);
    expect((html.match(new RegExp(`>${admin.detail.notCutOut}<`, 'g')) ?? []).length).toBe(2);
  });

  it('a single order shows one design, the badge from its kind, and the old design download', async () => {
    const png = await detail(single('png'));
    expect(png).toContain('/api/admin/files/order-single-00001/design"');
    expect(png).not.toContain('design-1');
    expect(png).toContain('single.png');
    expect((png.match(new RegExp(`>${admin.detail.cutOut}<`, 'g')) ?? []).length).toBe(1);
    const jpg = await detail(single('jpeg'));
    expect((jpg.match(new RegExp(`>${admin.detail.notCutOut}<`, 'g')) ?? []).length).toBe(1);
    expect(jpg).not.toContain(`>${admin.detail.cutOut}<`);
  });
});
