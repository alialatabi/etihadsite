import { admin } from '@/content/ar';
import { verifySession } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { customersToCsv } from './csv';

export const dynamic = 'force-dynamic';

/** GET /api/admin/customers — CSV (UTF-8 + BOM) of every saved customer. Auth re-checked here. */
export async function GET(): Promise<Response> {
  if (!(await verifySession())) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const customers = await getStorage().listCustomers();
  const c = admin.customers.columns;
  const headers = [
    c.name,
    c.phone,
    c.governorate,
    c.district,
    c.landmark,
    c.orders,
    c.spent,
    admin.customers.firstOrder,
    c.last,
    admin.customers.lastNo,
  ];
  const body = customersToCsv(headers, customers);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${admin.customers.csvFile}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
