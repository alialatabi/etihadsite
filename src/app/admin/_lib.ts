import { SHOP_TIME_ZONE } from '@/config/defaults';
import { admin } from '@/content/ar';
import type { Material, OrderRecord, OrderStatus } from '@/lib/types';

export const statusVariant: Record<OrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  new: 'default',
  printing: 'secondary',
  done: 'outline',
  cancelled: 'destructive',
};

export function formatBaghdad(iso: string): string {
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    timeZone: SHOP_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export const telegramLabel: Record<OrderRecord['notified']['telegram'], string> = {
  sent: admin.orders.telegramSent,
  failed: admin.orders.telegramFailed,
  skipped: admin.orders.telegramSkipped,
};

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
  };
}
