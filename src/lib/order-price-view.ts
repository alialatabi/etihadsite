/**
 * Price fields of a stored order, for the admin screens and the PDF download name. Pure.
 * Orders saved before the per-sheet pricing change have another shape, so nothing here may
 * assume that `price` is complete.
 */
import type { Material, OrderRecord } from '@/lib/types';

/** Orders saved before the per-sheet pricing change had `offer` + `price.offerPriceIqd`. */
type StoredOrder = Omit<OrderRecord, 'price'> & {
  offer?: { sheets?: number };
  price?: Partial<OrderRecord['price']>;
};

export interface OrderPriceView {
  material: Material | null;
  sheets: number | null;
  unitPriceIqd: number | null;
  discountPercent: number | null;
  subtotalIqd: number | null;
  deliveryFeeIqd: number | null;
  totalIqd: number | null;
  totalStickers: number | null;
  /** Sticker count the customer typed; null on sheet-count orders (all orders before 2026-11-11). */
  requestedStickers: number | null;
}

/** Reads price fields from new and legacy stored orders without throwing. */
export function orderPriceView(record: OrderRecord): OrderPriceView {
  const r = record as unknown as StoredOrder;
  const p = r.price ?? {};
  return {
    material: p.material ?? null,
    sheets: p.sheets ?? r.offer?.sheets ?? null,
    unitPriceIqd: p.unitPriceIqd ?? null,
    discountPercent: p.discountPercent ?? null,
    subtotalIqd: p.subtotalIqd ?? null,
    deliveryFeeIqd: p.deliveryFeeIqd ?? null,
    totalIqd: p.totalIqd ?? null,
    totalStickers: p.totalStickers ?? null,
    requestedStickers: p.requestedStickers ?? null,
  };
}
