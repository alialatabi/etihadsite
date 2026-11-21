import { admin } from '@/content/ar';
import { adminApiGuard } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';
import { customersCsv } from './csv';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/customers — CSV (UTF-8 + BOM) of every saved customer. Auth re-checked here.
 * `?marketing=1` exports only the customers who agreed to WhatsApp offers.
 */
export async function GET(request?: Request): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const marketingOnly = request ? new URL(request.url).searchParams.get('marketing') === '1' : false;
  const customers = await getStorage().listCustomers();
  const body = customersCsv(customers, { marketingOnly });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${marketingOnly ? admin.customers.marketingCsvFile : admin.customers.csvFile}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
