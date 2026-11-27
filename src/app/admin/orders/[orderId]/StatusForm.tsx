'use client';

import { useState } from 'react';
import { PendingSubmit } from '@/components/admin/PendingSubmit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { btn, field } from '@/components/admin/kit';
import { admin, order } from '@/content/ar';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { updateOrderStatus } from '../../actions';

export function StatusForm({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [value, setValue] = useState<OrderStatus>(status);
  return (
    <form action={updateOrderStatus} className="flex flex-col gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="status" value={value} />
      <Select value={value} onValueChange={(v) => setValue(v as OrderStatus)}>
        <SelectTrigger className={cn(field.input, field.select)} aria-label={admin.detail.status}>
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
      <PendingSubmit shadcn disabled={value === status} className={cn(btn.primary, 'w-full')}>
        {admin.orders.changeStatus}
      </PendingSubmit>
    </form>
  );
}
