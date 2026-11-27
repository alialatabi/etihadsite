import { accounts } from '@/content/ar/accounts';
import { computeWeek } from '@/lib/accounting/compute';
import { weekCsv } from '@/lib/accounting/csv';
import { resolveWeek } from '@/lib/accounting/view';
import { weekRange } from '@/lib/accounting/week';
import { adminApiGuard } from '@/lib/auth/session';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/accounts/export?week=YYYY-MM-DD — the week's sold orders as CSV (UTF-8 + BOM) for Excel.
 * `week` is the Saturday that starts the week; anything invalid or in the future means the current week.
 * No customer data in the file. Auth re-checked here.
 */
export async function GET(request?: Request): Promise<Response> {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const weekKey = resolveWeek(request ? new URL(request.url).searchParams.get('week') : null, new Date());
  const storage = getStorage();
  const { fromIso, toIso } = weekRange(weekKey);
  const [orders, settings] = await Promise.all([storage.listOrdersBetween(fromIso, toIso), storage.getSettings()]);
  const body = weekCsv(computeWeek(orders, settings.accounting?.sheetCosts ?? []));
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${accounts.csv.filePrefix}-${weekKey}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
