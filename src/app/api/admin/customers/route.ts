import { admin } from '@/content/ar';
import { adminApiGuard } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { customersCsv } from './csv';

export const dynamic = 'force-dynamic';

/** GET /api/admin/customers — CSV (UTF-8 + BOM) of every saved customer. Auth re-checked here. */
export async function GET(): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const customers = await getStorage().listCustomers();
  const body = customersCsv(customers);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${admin.customers.csvFile}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
