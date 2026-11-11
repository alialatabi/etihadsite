/**
 * Pure aggregation for the admin statistics page. No I/O, no server-only imports,
 * so it can be unit-tested directly.
 *
 * Visitors: `visitor` is a daily-rotating hash, so one distinct hash == one visitor-day.
 * Orders/revenue come from 'order' events (the orders table is purged by the retention cron).
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { DAY_MS, shopDayKey } from '@/lib/shop-time';
import type { AnalyticsEvent, CustomerRecord, DeviceKind, TrafficSource } from '@/lib/types';

export const STATS_TZ = SHOP_TIME_ZONE;
export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];
export const DEFAULT_RANGE: RangeDays = 30;

export function parseRange(raw: string | string[] | undefined): RangeDays {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_TIME_ZONE,
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});
/** en-US short weekday names, Saturday first (the shop's week). */
const WEEKDAY_ORDER = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** "YYYY-MM-DD" in shop time. */
export function dayKey(d: Date): string {
  return shopDayKey(d);
}

/** Saturday-first weekday index (0 = Saturday … 6 = Friday) and hour 0-23, Baghdad time. */
export function weekdayAndHour(d: Date): { weekday: number; hour: number } {
  const parts = partsFmt.formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sat';
  const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return { weekday: Math.max(0, WEEKDAY_ORDER.indexOf(wd)), hour: hr };
}

/** Day keys (oldest first) for the `days` days ending at `now` (inclusive). */
export function rangeDayKeys(now: Date, days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  return keys;
}

/** Lower bound to pass to listEvents (one extra day of slack; events are re-filtered by day key). */
export function sinceFor(now: Date, days: number): Date {
  return new Date(now.getTime() - (days + 1) * DAY_MS);
}

export interface CountRow<K extends string = string> {
  key: K;
  count: number;
}

export interface FunnelStep {
  id: 'visitors' | 'started' | 'uploaded' | 'size' | 'quantity' | 'details' | 'ordered';
  count: number;
  /** % of the previous step (null for the first step or when the previous is 0). */
  ofPreviousPct: number | null;
  /** % of the first step, for the bar width. */
  ofFirstPct: number;
}

export interface DailyPoint {
  day: string;
  visitors: number;
  orders: number;
}

export interface Stats {
  days: number;
  hasData: boolean;
  visits: number;
  visitorsToday: number;
  uploads: number;
  orders: number;
  uploadToOrderPct: number | null;
  visitToOrderPct: number | null;
  revenueIqd: number;
  avgOrderIqd: number | null;
  avgSheets: number | null;
  installs: number;
  funnel: FunnelStep[];
  daily: DailyPoint[];
  sources: CountRow<TrafficSource>[];
  devices: CountRow<DeviceKind>[];
  cities: CountRow[];
  governorates: CountRow[];
  materials: CountRow[];
  shapes: CountRow[];
  /** key = "W×H" in cm. */
  sizes: CountRow[];
  weekdays: { visitors: number; orders: number }[];
  hours: { visitors: number; orders: number }[];
  newCustomers: number;
  returningCustomers: number;
}

export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function sortRows<K extends string>(map: Map<K, number>, limit?: number): CountRow<K>[] {
  const rows = [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return limit ? rows.slice(0, limit) : rows;
}

function bump<K>(m: Map<K, number>, k: K, by = 1): void {
  m.set(k, (m.get(k) ?? 0) + by);
}

/** mm → cm text without trailing zeros ("4", "4.5"). */
export function mmToCmText(mm: number): string {
  return String(Math.round(mm) / 10);
}

export function aggregate(
  events: AnalyticsEvent[],
  customers: CustomerRecord[],
  opts: { now: Date; days: number },
): Stats {
  const keys = rangeDayKeys(opts.now, opts.days);
  const inRange = new Set(keys);
  const today = keys[keys.length - 1];

  const dailyVisitors = new Map<string, Set<string>>(keys.map((k) => [k, new Set<string>()]));
  const dailyOrders = new Map<string, number>(keys.map((k) => [k, 0]));

  const pageVisitors = new Set<string>(); // visitor hashes (visitor-day)
  const stepSets: Record<string, Set<string>> = {
    shape: new Set(),
    design: new Set(),
    size: new Set(),
    quantity: new Set(),
    details: new Set(),
  };
  const uploadVisitors = new Set<string>();
  const orderVisitors = new Set<string>();

  const sourceByVisitor = new Map<string, TrafficSource>();
  const deviceByVisitor = new Map<string, DeviceKind>();
  const cityByVisitor = new Map<string, string>();
  const weekdayVisitors: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  const hourVisitors: Set<string>[] = Array.from({ length: 24 }, () => new Set<string>());
  const weekdays = Array.from({ length: 7 }, () => ({ visitors: 0, orders: 0 }));
  const hours = Array.from({ length: 24 }, () => ({ visitors: 0, orders: 0 }));

  let uploads = 0;
  let orders = 0;
  let revenue = 0;
  let pricedOrders = 0;
  let sheetsSum = 0;
  let sheetsOrders = 0;
  let installs = 0;
  const governorates = new Map<string, number>();
  const materials = new Map<string, number>();
  const shapes = new Map<string, number>();
  const sizes = new Map<string, number>();

  for (const e of events) {
    const t = new Date(e.ts);
    if (Number.isNaN(t.getTime())) continue;
    const day = dayKey(t);
    if (!inRange.has(day)) continue;

    switch (e.type) {
      case 'pageview': {
        pageVisitors.add(e.visitor);
        dailyVisitors.get(day)!.add(e.visitor);
        const { weekday, hour } = weekdayAndHour(t);
        weekdayVisitors[weekday].add(e.visitor);
        hourVisitors[hour].add(e.visitor);
        if (e.source && !sourceByVisitor.has(e.visitor)) sourceByVisitor.set(e.visitor, e.source);
        if (e.device && !deviceByVisitor.has(e.visitor)) deviceByVisitor.set(e.visitor, e.device);
        if (e.city && !cityByVisitor.has(e.visitor)) cityByVisitor.set(e.visitor, e.city);
        break;
      }
      case 'step': {
        if (e.step && Object.hasOwn(stepSets, e.step)) stepSets[e.step].add(e.visitor);
        break;
      }
      case 'upload': {
        uploads++;
        uploadVisitors.add(e.visitor);
        break;
      }
      case 'install': {
        if (e.step === 'installed') installs++;
        break;
      }
      case 'order': {
        orders++;
        orderVisitors.add(e.visitor);
        dailyOrders.set(day, (dailyOrders.get(day) ?? 0) + 1);
        const { weekday, hour } = weekdayAndHour(t);
        weekdays[weekday].orders++;
        hours[hour].orders++;
        const m = e.meta ?? {};
        const total = num(m.totalIqd);
        if (total !== null && total > 0) {
          revenue += total;
          pricedOrders++;
        }
        const sheets = num(m.sheets);
        if (sheets !== null && sheets > 0) {
          sheetsSum += sheets;
          sheetsOrders++;
        }
        const gov = str(m.governorate);
        if (gov) bump(governorates, gov);
        const mat = str(m.material);
        if (mat) bump(materials, mat);
        const shape = str(m.shape);
        if (shape) bump(shapes, shape);
        const w = num(m.widthMm);
        const h = num(m.heightMm);
        if (w && h) bump(sizes, `${mmToCmText(w)}×${mmToCmText(h)}`);
        break;
      }
    }
  }

  weekdayVisitors.forEach((s, i) => (weekdays[i].visitors = s.size));
  hourVisitors.forEach((s, i) => (hours[i].visitors = s.size));

  const daily: DailyPoint[] = keys.map((day) => ({
    day,
    visitors: dailyVisitors.get(day)!.size,
    orders: dailyOrders.get(day) ?? 0,
  }));
  const visits = daily.reduce((a, d) => a + d.visitors, 0);

  // Funnel — distinct visitor hashes. A visitor who uploaded counts as having reached "design".
  const uploaded = new Set([...stepSets.design, ...uploadVisitors]);
  const counts: [FunnelStep['id'], number][] = [
    ['visitors', pageVisitors.size],
    ['started', stepSets.shape.size],
    ['uploaded', uploaded.size],
    ['size', stepSets.size.size],
    ['quantity', stepSets.quantity.size],
    ['details', stepSets.details.size],
    ['ordered', orderVisitors.size],
  ];
  const first = counts[0][1];
  const funnel: FunnelStep[] = counts.map(([id, count], i) => ({
    id,
    count,
    ofPreviousPct: i === 0 ? null : pct(count, counts[i - 1][1]),
    ofFirstPct: first ? Math.min(100, Math.round((count / first) * 1000) / 10) : 0,
  }));

  const countBy = <K extends string>(m: Map<string, K>): Map<K, number> => {
    const out = new Map<K, number>();
    for (const v of m.values()) bump(out, v);
    return out;
  };

  const returningCustomers = customers.filter((c) => c.ordersCount >= 2).length;

  return {
    days: opts.days,
    hasData: events.length > 0 || customers.length > 0,
    visits,
    visitorsToday: dailyVisitors.get(today)?.size ?? 0,
    uploads,
    orders,
    uploadToOrderPct: pct(orders, uploads),
    visitToOrderPct: pct(orders, visits),
    revenueIqd: revenue,
    avgOrderIqd: pricedOrders ? Math.round(revenue / pricedOrders) : null,
    avgSheets: sheetsOrders ? Math.round((sheetsSum / sheetsOrders) * 10) / 10 : null,
    installs,
    funnel,
    daily,
    sources: sortRows(countBy(sourceByVisitor)),
    devices: sortRows(countBy(deviceByVisitor)),
    cities: sortRows(countBy(cityByVisitor), 10),
    governorates: sortRows(governorates),
    materials: sortRows(materials),
    shapes: sortRows(shapes),
    sizes: sortRows(sizes, 8),
    weekdays,
    hours,
    newCustomers: customers.length - returningCustomers,
    returningCustomers,
  };
}
