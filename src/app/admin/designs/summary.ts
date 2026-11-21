/**
 * Counters and limit alerts of the admin designs page. Pure (no I/O).
 * Only `kind === 'image'` rows count as designs; brief rows have their own, higher limit
 * and never raise an alert. A row with `ipKey === ''` is the site-only row (no per-IP
 * check was possible) and never raises an alert either. Neither does an already blocked IP.
 * The all-time count is not here: it is the number of stored generations (aiListGenerations total).
 */
import { DAY_MS } from '@/lib/shop-time';
import type { AiUsageRow } from '@/lib/types';

export interface DesignAlert {
  ipKey: string;
  ip: string;
  count: number;
  lastAt: string;
  day: string;
}

export interface DesignsSummary {
  today: number;
  month: number;
  alerts: DesignAlert[];
}

/** The shop day before `today` (both YYYY-MM-DD). */
function previousDay(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * The first usage day the summary needs: the first day of this month, or yesterday (alerts look one
 * day back) when that is earlier. Older rows are never read.
 */
export function usageSince(today: string): string {
  const monthStart = `${today.slice(0, 7)}-01`;
  const yesterday = previousDay(today);
  return yesterday < monthStart ? yesterday : monthStart;
}

/** Highest gallery page the page accepts (a huge ?page would ask storage for an absurd offset). */
export const MAX_DESIGNS_PAGE = 100_000;

/** `?page`: a whole number from 1 to MAX_DESIGNS_PAGE (larger ones are capped); anything else is page 1. */
export function pageFromParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, MAX_DESIGNS_PAGE) : 1;
}

/** The nav badge: how many customers (distinct IP keys) are at their limit and not blocked yet. */
export function alertBadgeCount(alerts: DesignAlert[]): number {
  return new Set(alerts.map((a) => a.ipKey)).size;
}

/** Epoch ms of a stored timestamp (`+00:00` from Supabase, `Z` from local files); invalid → 0. */
function at(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** `blockedKeys`: IPs already blocked never appear in `alerts` (nothing left to act on); their uses still count. */
export function designsSummary(
  usage: AiUsageRow[],
  today: string,
  perIpLimit: number,
  blockedKeys: ReadonlySet<string> = new Set(),
): DesignsSummary {
  const month = today.slice(0, 7);
  const yesterday = previousDay(today);
  let todayCount = 0;
  let monthCount = 0;
  const alerts: DesignAlert[] = [];

  for (const r of usage) {
    if (r.kind !== 'image') continue;
    if (r.day.slice(0, 7) === month) monthCount += r.count;
    if (r.day === today) todayCount += r.count;
    if (r.ipKey !== '' && !blockedKeys.has(r.ipKey) && (r.day === today || r.day === yesterday) && r.count >= perIpLimit) {
      alerts.push({ ipKey: r.ipKey, ip: r.ip, count: r.count, lastAt: r.lastAt, day: r.day });
    }
  }

  alerts.sort((a, b) => at(b.lastAt) - at(a.lastAt));
  return { today: todayCount, month: monthCount, alerts };
}
