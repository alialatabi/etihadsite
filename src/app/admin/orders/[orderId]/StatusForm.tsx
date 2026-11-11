'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { admin, order } from '@/content/ar';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/types';
import { updateOrderStatus } from '../../actions';

export function StatusForm({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [value, setValue] = useState<OrderStatus>(status);
  return (
    <form action={updateOrderStatus} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="status" value={value} />
      <Select value={value} onValueChange={(v) => setValue(v as OrderStatus)}>
        <SelectTrigger className="w-44" aria-label={admin.detail.status}>
          <SelectValue>{order.status[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent dir="rtl">
          {ORDER_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {order.status[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={value === status}>
        {admin.orders.changeStatus}
      </Button>
    </form>
  );
}
