import type { Material, OrderRecord, OrderStatus, PriceBreakdown } from '@/lib/types';

export interface OrderOpts {
  id?: string;
  createdAt: string;
  status?: OrderStatus;
  material?: Material;
  sheets?: number;
  /** Per-sheet price before discount; null = no price published. */
  unitBase?: number | null;
  discountPercent?: number;
  delivery?: number;
  perSheet?: number;
}

let seq = 0;

/** A stored order with a consistent price block: total = unitPrice x sheets + delivery (no rounding). */
export function makeOrder(o: OrderOpts): OrderRecord {
  const sheets = o.sheets ?? 10;
  const delivery = o.delivery ?? 5000;
  const base = o.unitBase === undefined ? 1000 : o.unitBase;
  const pct = o.discountPercent ?? 0;
  const unit = base === null ? null : Math.round((base * (100 - pct)) / 100);
  const subtotal = unit === null ? null : unit * sheets;
  const price: PriceBreakdown = {
    material: o.material ?? 'paper',
    sheets,
    unitBaseIqd: base,
    discountPercent: pct,
    unitPriceIqd: unit,
    subtotalIqd: subtotal,
    deliveryFeeIqd: delivery,
    totalIqd: subtotal === null ? null : subtotal + delivery,
    totalStickers: sheets * (o.perSheet ?? 54),
    perStickerIqd: null,
  };
  const id = o.id ?? `order-test-${String(++seq).padStart(4, '0')}`;
  return {
    orderId: id,
    displayNo: `EP-${id}`,
    createdAt: o.createdAt,
    status: o.status ?? 'new',
    spec: { shape: 'circle', widthUm: 30000, heightUm: 30000 },
    layout: { cols: 6, rows: 9, countPerSheet: o.perSheet ?? 54, rotated: false, cellWidthUm: 30000, cellHeightUm: 30000, gapXUm: 2000, gapYUm: 0 },
    design: { kind: 'png', originalName: 'a.png', bytes: 3, pxWidth: 10, pxHeight: 10 },
    price,
    customer: { name: 'زبون سري', phone: '9647701234567', governorate: 'بغداد', district: 'المنطقة', landmark: 'قرب الجسر' },
    files: { designPath: `uploads/${id}.bin`, pdfPath: `orders/${id}.pdf` },
    notified: { telegram: 'skipped' },
  } as OrderRecord;
}
