import { requireAdmin } from '@/lib/auth/guard';
import { getStorage } from '@/lib/storage';
import { admin } from '@/content/ar';
import { formatBaghdad } from '../_lib';
import { CustomersTable } from './CustomersTable';
import type { CustomerRow } from './filter';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  await requireAdmin();
  const storage = getStorage();
  const [customers, orders] = await Promise.all([storage.listCustomers(), storage.listOrders()]);
  const existing = new Set(orders.map((o) => o.orderId));
  const rows: CustomerRow[] = customers.map((c) => ({
    phone: c.phone,
    name: c.name ?? '',
    governorate: c.governorate,
    district: c.district,
    landmark: c.landmark,
    ordersCount: c.ordersCount,
    totalIqd: c.totalIqd,
    lastLabel: formatBaghdad(c.lastOrderAt),
    lastDisplayNo: c.lastDisplayNo,
    lastOrderId: existing.has(c.lastOrderId) ? c.lastOrderId : null,
  }));
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{admin.customers.title}</h1>
      <CustomersTable rows={rows} />
    </section>
  );
}
