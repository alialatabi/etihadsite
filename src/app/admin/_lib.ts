import { admin } from '@/content/ar';
import { DAY_MS } from '@/lib/shop-time';
import type { OrderRecord, OrderStatus } from '@/lib/types';

export const statusVariant: Record<OrderStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  new: 'default',
  printing: 'secondary',
  done: 'outline',
  cancelled: 'destructive',
};

export { formatShopDateTime as formatBaghdad } from '@/lib/shop-time';
export { orderPriceView, type OrderPriceView } from '@/lib/order-price-view';

export const telegramLabel: Record<OrderRecord['notified']['telegram'], string> = {
  sent: admin.orders.telegramSent,
  failed: admin.orders.telegramFailed,
  skipped: admin.orders.telegramSkipped,
};

/**
 * True once the daily purge has (or is about to have) removed the order's print PDF: the order
 * is older than retentionDays. Computed only, no storage call. The design is kept (D10).
 */
export function isPdfPurged(createdAt: string, retentionDays: number, now: Date = new Date()): boolean {
  return new Date(createdAt).getTime() < now.getTime() - retentionDays * DAY_MS;
}
