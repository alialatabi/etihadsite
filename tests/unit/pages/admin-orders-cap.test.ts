/** The admin orders list says so when it hit the 1000-order cap of listOrders(). No JSX here (the glob is *.test.ts). */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { OrderRecord } from '@/lib/types';

let orders: OrderRecord[] = [];
vi.mock('@/lib/auth/guard', () => ({ requireAdmin: async () => undefined }));
vi.mock('@/lib/storage', () => ({ getStorage: () => ({ listOrders: async () => orders }) }));
vi.mock('@/components/admin/SheetPdfPreview', () => ({ SheetPdfPreview: () => null }));

import OrdersPage from '@/app/admin/page';
import { admin } from '@/content/ar';

function record(i: number): OrderRecord {
  const id = `order-${String(i).padStart(6, '0')}`;
  return {
    orderId: id,
    displayNo: 'EP-261201-ABCD',
    createdAt: '2026-11-20T10:00:00.000Z',
    status: 'new',
    spec: { shape: 'circle', widthUm: 30000, heightUm: 30000 },
    layout: { cols: 6, rows: 9, countPerSheet: 54, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0 },
    design: { kind: 'png', originalName: 'a.png', bytes: 3, pxWidth: 10, pxHeight: 10, effectiveDpi: 300 },
    price: {
      material: 'paper',
      sheets: 20,
      unitBaseIqd: null,
      discountPercent: 0,
      unitPriceIqd: null,
      subtotalIqd: null,
      deliveryFeeIqd: 5000,
      totalIqd: null,
      totalStickers: 1080,
      perStickerIqd: null,
    },
    customer: { phone: '9647701234567', governorate: 'بغداد', district: 'x', landmark: 'y' },
    files: { designPath: `uploads/${id}.bin`, pdfPath: `orders/${id}.pdf` },
    notified: { telegram: 'skipped' },
  } as OrderRecord;
}

const html = async () => renderToStaticMarkup(await OrdersPage());

describe('admin orders list cap', () => {
  it('shows the notice only when exactly 1000 orders came back', async () => {
    expect(admin.orders.capped).toBe('يظهر آخر 1000 طلب فقط.');
    orders = Array.from({ length: 1000 }, (_, i) => record(i));
    expect(await html()).toContain(admin.orders.capped);
    orders = Array.from({ length: 999 }, (_, i) => record(i));
    expect(await html()).not.toContain(admin.orders.capped);
    orders = [];
    expect(await html()).not.toContain(admin.orders.capped);
  });
});
