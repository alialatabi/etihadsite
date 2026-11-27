/**
 * Accounting weeks. Pure (no I/O). A week runs from Saturday 00:00 to the next Saturday 00:00 in SHOP
 * time (SHOP_TIME_ZONE); its key is the calendar date of that Saturday, "YYYY-MM-DD". The UTC instant
 * of a shop-time midnight is derived from Intl (not a hard-coded +3), so a zone with a DST change
 * would still be right.
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { shopDayKey } from '@/lib/shop-time';

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Day-of-week of a Saturday in Date#getUTCDay() terms. */
const SATURDAY = 6;
const DAY_MS = 86_400_000;

const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of the shop zone from UTC at an instant, in ms (local wall clock minus UTC). */
function zoneOffsetMs(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of PARTS_FORMAT.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant at which the shop-time calendar date `y-m-d` starts (00:00 in the shop zone). */
function shopMidnightUtcMs(y: number, m: number, d: number): number {
  const naive = Date.UTC(y, m - 1, d);
  const first = naive - zoneOffsetMs(naive);
  return naive - zoneOffsetMs(first);
}

function splitKey(key: string): [number, number, number] {
  const m = KEY_RE.exec(key);
  if (!m) throw new RangeError(`invalid day key: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function keyOfUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since the most recent Saturday for a "YYYY-MM-DD" calendar date (Saturday = 0 .. Friday = 6). */
function daysSinceSaturday(dayKey: string): number {
  const [y, m, d] = splitKey(dayKey);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - SATURDAY + 7) % 7;
}

/** Key ("YYYY-MM-DD" of the Saturday, shop calendar) of the week that contains `date`. */
export function weekKeyOf(date: Date): string {
  const dayKey = shopDayKey(date);
  const [y, m, d] = splitKey(dayKey);
  return keyOfUtcDate(Date.UTC(y, m - 1, d - daysSinceSaturday(dayKey)));
}

/** The week's UTC bounds, ISO 8601: Saturday 00:00 shop time (inclusive) to the next Saturday 00:00 (exclusive). */
export function weekRange(key: string): { fromIso: string; toIso: string } {
  const [y, m, d] = splitKey(key);
  const [ny, nm, nd] = splitKey(addWeeks(key, 1));
  return {
    fromIso: new Date(shopMidnightUtcMs(y, m, d)).toISOString(),
    toIso: new Date(shopMidnightUtcMs(ny, nm, nd)).toISOString(),
  };
}

/** The key `n` weeks after `key` (negative = before). Calendar arithmetic, never a fixed millisecond step. */
export function addWeeks(key: string, n: number): string {
  const [y, m, d] = splitKey(key);
  return keyOfUtcDate(Date.UTC(y, m - 1, d + 7 * n));
}

/** The Friday that ends the week (the key plus 6 days), "YYYY-MM-DD". */
export function weekEndKey(key: string): string {
  const [y, m, d] = splitKey(key);
  return keyOfUtcDate(Date.UTC(y, m - 1, d + 6));
}

/** A `?week=` value → a week key, or null when it is not a valid calendar date that falls on a Saturday. */
export function parseWeekKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = KEY_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.getUTCDay() === SATURDAY ? value : null;
}

/** Day of the week of an order, 0..6 in shop time (Saturday = 0 .. Friday = 6). */
export function dayIndex(createdAt: string): number {
  return daysSinceSaturday(shopDayKey(new Date(createdAt)));
}

/** Whole weeks between two keys (b - a). */
export function weeksBetween(a: string, b: string): number {
  const [ay, am, ad] = splitKey(a);
  const [by, bm, bd] = splitKey(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (7 * DAY_MS));
}
