import { describe, expect, it } from 'vitest';
import {
  aggregate,
  dayKey,
  mmToCmText,
  parseRange,
  pct,
  rangeDayKeys,
  weekdayAndHour,
} from '@/app/admin/stats/aggregate';
import type { AnalyticsEvent, CustomerRecord } from '@/lib/types';

// 2026-11-10 is a Tuesday. 12:00 UTC = 15:00 Baghdad.
const NOW = new Date('2026-11-10T12:00:00Z');

const ev = (over: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, 'type' | 'visitor'>): AnalyticsEvent => ({
  ts: '2026-11-10T09:00:00Z',
  ...over,
});

const cust = (phone: string, ordersCount: number): CustomerRecord => ({
  phone,
  governorate: 'بغداد',
  district: 'x',
  landmark: 'y',
  firstOrderAt: '2026-11-01T00:00:00Z',
  lastOrderAt: '2026-11-02T00:00:00Z',
  ordersCount,
  totalIqd: 1000,
  lastOrderId: 'o',
  lastDisplayNo: 'EP-1',
});

describe('helpers', () => {
  it('parseRange accepts 7/30/90 and defaults to 30', () => {
    expect(parseRange('7')).toBe(7);
    expect(parseRange('90')).toBe(90);
    expect(parseRange('15')).toBe(30);
    expect(parseRange(undefined)).toBe(30);
    expect(parseRange(['7', '90'])).toBe(7);
  });
  it('dayKey uses Baghdad time (UTC+3)', () => {
    expect(dayKey(new Date('2026-11-09T21:30:00Z'))).toBe('2026-11-10');
    expect(dayKey(new Date('2026-11-09T20:59:00Z'))).toBe('2026-11-09');
  });
  it('weekdayAndHour is Saturday-first, Baghdad hour', () => {
    expect(weekdayAndHour(NOW)).toEqual({ weekday: 3, hour: 15 }); // Tuesday
    expect(weekdayAndHour(new Date('2026-11-06T21:00:00Z'))).toEqual({ weekday: 0, hour: 0 }); // Sat 00:00
  });
  it('rangeDayKeys returns N ascending days ending today', () => {
    const k = rangeDayKeys(NOW, 7);
    expect(k).toHaveLength(7);
    expect(k[6]).toBe('2026-11-10');
    expect(k[0]).toBe('2026-11-04');
  });
  it('pct and mmToCmText', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBeNull();
    expect(mmToCmText(40)).toBe('4');
    expect(mmToCmText(45)).toBe('4.5');
  });
});

describe('aggregate', () => {
  it('handles no data', () => {
    const s = aggregate([], [], { now: NOW, days: 30 });
    expect(s.hasData).toBe(false);
    expect(s.visits).toBe(0);
    expect(s.orders).toBe(0);
    expect(s.visitToOrderPct).toBeNull();
    expect(s.uploadToOrderPct).toBeNull();
    expect(s.avgOrderIqd).toBeNull();
    expect(s.avgSheets).toBeNull();
    expect(s.daily).toHaveLength(30);
    expect(s.funnel.every((f) => f.count === 0 && f.ofFirstPct === 0)).toBe(true);
  });

  it('counts unique visitors per day and sums days', () => {
    const events = [
      ev({ type: 'pageview', visitor: 'a' }),
      ev({ type: 'pageview', visitor: 'a', path: '/other' }),
      ev({ type: 'pageview', visitor: 'b' }),
      ev({ type: 'pageview', visitor: 'c', ts: '2026-11-09T09:00:00Z' }),
    ];
    const s = aggregate(events, [], { now: NOW, days: 7 });
    expect(s.visits).toBe(3);
    expect(s.visitorsToday).toBe(2);
    expect(s.daily.at(-1)).toMatchObject({ day: '2026-11-10', visitors: 2 });
    expect(s.daily.at(-2)).toMatchObject({ day: '2026-11-09', visitors: 1 });
  });

  it('ignores events outside the range', () => {
    const events = [ev({ type: 'pageview', visitor: 'old', ts: '2026-09-01T09:00:00Z' })];
    const s = aggregate(events, [], { now: NOW, days: 7 });
    expect(s.visits).toBe(0);
  });

  it('ignores events with an invalid timestamp', () => {
    const s = aggregate([ev({ type: 'pageview', visitor: 'a', ts: 'nope' })], [], { now: NOW, days: 7 });
    expect(s.visits).toBe(0);
  });

  it('computes orders, revenue, averages and rates from order events', () => {
    const events: AnalyticsEvent[] = [
      ev({ type: 'pageview', visitor: 'a' }),
      ev({ type: 'pageview', visitor: 'b' }),
      ev({ type: 'pageview', visitor: 'c' }),
      ev({ type: 'pageview', visitor: 'd' }),
      ev({ type: 'upload', visitor: 'a' }),
      ev({ type: 'upload', visitor: 'b' }),
      ev({ type: 'upload', visitor: 'b' }),
      ev({ type: 'upload', visitor: 'c' }),
      ev({
        type: 'order',
        visitor: 'a',
        meta: { material: 'paper', sheets: 10, totalIqd: 20000, governorate: 'بغداد', shape: 'circle', widthMm: 40, heightMm: 40 },
      }),
      ev({
        type: 'order',
        visitor: 'b',
        meta: { material: 'plastic', sheets: 5, totalIqd: 10000, governorate: 'بغداد', shape: 'rect', widthMm: 45, heightMm: 30 },
      }),
      // unpriced order: counts as an order but not in revenue/average
      ev({ type: 'order', visitor: 'c', meta: { material: 'paper', sheets: 3, totalIqd: null, governorate: 'البصرة', shape: 'circle', widthMm: 40, heightMm: 40 } }),
    ];
    const s = aggregate(events, [], { now: NOW, days: 30 });
    expect(s.visits).toBe(4);
    expect(s.uploads).toBe(4);
    expect(s.orders).toBe(3);
    expect(s.uploadToOrderPct).toBe(75);
    expect(s.visitToOrderPct).toBe(75);
    expect(s.revenueIqd).toBe(30000);
    expect(s.avgOrderIqd).toBe(15000);
    expect(s.avgSheets).toBe(6);
    expect(s.governorates).toEqual([
      { key: 'بغداد', count: 2 },
      { key: 'البصرة', count: 1 },
    ]);
    expect(s.materials).toEqual([
      { key: 'paper', count: 2 },
      { key: 'plastic', count: 1 },
    ]);
    expect(s.shapes[0]).toEqual({ key: 'circle', count: 2 });
    expect(s.sizes[0]).toEqual({ key: '4×4', count: 2 });
    expect(s.sizes[1]).toEqual({ key: '4.5×3', count: 1 });
    expect(s.daily.at(-1)?.orders).toBe(3);
  });

  it('builds a funnel with percent of previous step', () => {
    const v = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    const events: AnalyticsEvent[] = [
      ...v(10).map((x) => ev({ type: 'pageview', visitor: x })),
      ...v(8).map((x) => ev({ type: 'step', visitor: x, step: 'shape' })),
      ...v(4).map((x) => ev({ type: 'step', visitor: x, step: 'design' })),
      // v4 uploaded but has no 'design' step event: still counts as uploaded
      ev({ type: 'upload', visitor: 'v4' }),
      ...v(3).map((x) => ev({ type: 'step', visitor: x, step: 'size' })),
      ...v(2).map((x) => ev({ type: 'step', visitor: x, step: 'quantity' })),
      ev({ type: 'step', visitor: 'v0', step: 'details' }),
      ev({ type: 'order', visitor: 'v0', meta: { totalIqd: 1000 } }),
    ];
    const s = aggregate(events, [], { now: NOW, days: 30 });
    expect(s.funnel.map((f) => f.id)).toEqual(['visitors', 'started', 'uploaded', 'size', 'quantity', 'details', 'ordered']);
    expect(s.funnel.map((f) => f.count)).toEqual([10, 8, 5, 3, 2, 1, 1]);
    expect(s.funnel[0].ofPreviousPct).toBeNull();
    expect(s.funnel[1].ofPreviousPct).toBe(80);
    expect(s.funnel[2].ofPreviousPct).toBe(62.5);
    expect(s.funnel[6].ofPreviousPct).toBe(100);
    expect(s.funnel[0].ofFirstPct).toBe(100);
    expect(s.funnel[2].ofFirstPct).toBe(50);
  });

  it('zero previous step gives null percentage, not NaN', () => {
    const s = aggregate([ev({ type: 'order', visitor: 'x', meta: { totalIqd: 5 } })], [], { now: NOW, days: 7 });
    expect(s.funnel[1].ofPreviousPct).toBeNull();
    expect(s.funnel[6].ofPreviousPct).toBeNull();
    expect(s.funnel[6].ofFirstPct).toBe(0);
  });

  it('breaks down sources, devices and cities by distinct visitor (first value wins)', () => {
    const events: AnalyticsEvent[] = [
      ev({ type: 'pageview', visitor: 'a', source: 'instagram', device: 'mobile', city: 'Baghdad' }),
      ev({ type: 'pageview', visitor: 'a', source: 'direct', device: 'desktop', city: 'Basra' }),
      ev({ type: 'pageview', visitor: 'b', source: 'instagram', device: 'mobile', city: 'Baghdad' }),
      ev({ type: 'pageview', visitor: 'c', source: 'google', device: 'tablet' }),
    ];
    const s = aggregate(events, [], { now: NOW, days: 7 });
    expect(s.sources).toEqual([
      { key: 'instagram', count: 2 },
      { key: 'google', count: 1 },
    ]);
    expect(s.devices[0]).toEqual({ key: 'mobile', count: 2 });
    expect(s.cities).toEqual([{ key: 'Baghdad', count: 2 }]);
  });

  it('buckets weekdays and hours in Baghdad time', () => {
    const events: AnalyticsEvent[] = [
      ev({ type: 'pageview', visitor: 'a', ts: '2026-11-10T12:00:00Z' }), // Tue 15:00
      ev({ type: 'pageview', visitor: 'b', ts: '2026-11-10T12:30:00Z' }), // Tue 15:30
      ev({ type: 'order', visitor: 'b', ts: '2026-11-10T12:31:00Z', meta: { totalIqd: 1 } }),
      ev({ type: 'pageview', visitor: 'c', ts: '2026-11-09T21:10:00Z' }), // Tue 00:10 Baghdad
    ];
    const s = aggregate(events, [], { now: NOW, days: 7 });
    expect(s.weekdays[3]).toEqual({ visitors: 3, orders: 1 });
    expect(s.hours[15]).toEqual({ visitors: 2, orders: 1 });
    expect(s.hours[0].visitors).toBe(1);
  });

  it('counts PWA installs only for step=installed', () => {
    const events: AnalyticsEvent[] = [
      ev({ type: 'install', visitor: 'a', step: 'shown' }),
      ev({ type: 'install', visitor: 'a', step: 'accepted' }),
      ev({ type: 'install', visitor: 'a', step: 'installed' }),
    ];
    expect(aggregate(events, [], { now: NOW, days: 7 }).installs).toBe(1);
  });

  it('splits new vs returning customers', () => {
    const s = aggregate([], [cust('1', 1), cust('2', 2), cust('3', 5)], { now: NOW, days: 7 });
    expect(s.newCustomers).toBe(1);
    expect(s.returningCustomers).toBe(2);
    expect(s.hasData).toBe(true);
  });

  it('ignores non-numeric meta values safely', () => {
    const s = aggregate(
      [ev({ type: 'order', visitor: 'a', meta: { totalIqd: 'abc', sheets: NaN, governorate: '  ', widthMm: 0, heightMm: 40 } })],
      [],
      { now: NOW, days: 7 },
    );
    expect(s.orders).toBe(1);
    expect(s.revenueIqd).toBe(0);
    expect(s.avgOrderIqd).toBeNull();
    expect(s.governorates).toEqual([]);
    expect(s.sizes).toEqual([]);
  });
});
