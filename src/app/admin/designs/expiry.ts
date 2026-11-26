/** Time left before an unordered design is deleted automatically. Pure (no I/O). */
import { PURGE_CRON_UTC, UNORDERED_DESIGN_DAYS } from '@/config/defaults';
import { DAY_MS, shopDayKey } from '@/lib/shop-time';

/**
 * The first daily purge run (UTC instant) at or after `due`. On the Vercel Hobby plan a daily cron may fire at
 * any minute of its hour, so the START of the hour is used: the pill can say a day early, never a day late.
 */
function firstPurgeRunAtOrAfter(due: number): number {
  const d = new Date(due);
  const sameDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PURGE_CRON_UTC.hour, 0);
  return sameDay >= due ? sameDay : sameDay + DAY_MS;
}

/** Whole calendar days from the shop day `a` to the shop day `b` (both "YYYY-MM-DD"). */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/**
 * Shop (Baghdad) calendar days until the purge really removes a design made at `createdAt` that no order
 * used. The purge only runs once a day (PURGE_CRON_UTC), so the deletion instant is the first run at or after
 * `createdAt + retentionDays`; the answer is how many Baghdad calendar days away that run is: 0 = it goes
 * today («ينحذف اليوم»), 3 = «ينحذف بعد 3 أيام». Overdue also gives 0; null when `createdAt` is not a date
 * (no pill is shown then).
 */
export function daysUntilDeletion(
  createdAt: string,
  now: Date = new Date(),
  retentionDays: number = UNORDERED_DESIGN_DAYS,
): number | null {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;
  const run = firstPurgeRunAtOrAfter(created + retentionDays * DAY_MS);
  return Math.max(0, dayDiff(shopDayKey(now), shopDayKey(new Date(run))));
}
