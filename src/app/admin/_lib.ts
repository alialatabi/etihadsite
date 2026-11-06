import { SHOP_TIME_ZONE } from '@/config/defaults';
import { admin } from '@/content/ar';
import type { OrderRecord, OrderStatus } from '@/lib/types';

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
