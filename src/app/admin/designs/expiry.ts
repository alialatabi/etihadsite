/** Time left before an unordered design is deleted automatically. Pure (no I/O). */
import { UNORDERED_DESIGN_DAYS } from '@/config/defaults';
import { DAY_MS } from '@/lib/shop-time';

/**
 * Whole days left before the daily purge removes a design made at `createdAt` that no order used
 * (rounded down: the last day reads «اليوم»). 0 when it is due today or already overdue; null when
 * `createdAt` is not a date (no pill is shown then).
 */
export function daysUntilDeletion(
  createdAt: string,
  now: Date = new Date(),
  retentionDays: number = UNORDERED_DESIGN_DAYS,
): number | null {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;
  const msLeft = created + retentionDays * DAY_MS - now.getTime();
  return Math.max(0, Math.floor(msLeft / DAY_MS));
}
