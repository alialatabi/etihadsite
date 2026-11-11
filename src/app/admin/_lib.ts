import { admin } from '@/content/ar';
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
