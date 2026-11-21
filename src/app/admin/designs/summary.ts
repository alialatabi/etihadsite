/**
 * Counters and limit alerts of the admin designs page. Pure (no I/O).
 * Only `kind === 'image'` rows count as designs; brief rows have their own, higher limit
 * and never raise an alert. A row with `ipKey === ''` is the site-only row (no per-IP
 * check was possible) and never raises an alert either.
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
  allTime: number;
  alerts: DesignAlert[];
}

/** The shop day before `today` (both YYYY-MM-DD). */
function previousDay(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** Epoch ms of a stored timestamp (`+00:00` from Supabase, `Z` from local files); invalid → 0. */
function at(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function designsSummary(usage: AiUsageRow[], today: string, perIpLimit: number): DesignsSummary {
  const month = today.slice(0, 7);
  const yesterday = previousDay(today);
  let todayCount = 0;
  let monthCount = 0;
  let allTime = 0;
  const alerts: DesignAlert[] = [];

  for (const r of usage) {
    if (r.kind !== 'image') continue;
    allTime += r.count;
    if (r.day.slice(0, 7) === month) monthCount += r.count;
    if (r.day === today) todayCount += r.count;
    if (r.ipKey !== '' && (r.day === today || r.day === yesterday) && r.count >= perIpLimit) {
      alerts.push({ ipKey: r.ipKey, ip: r.ip, count: r.count, lastAt: r.lastAt, day: r.day });
    }
  }

  alerts.sort((a, b) => at(b.lastAt) - at(a.lastAt));
  return { today: todayCount, month: monthCount, allTime, alerts };
}
