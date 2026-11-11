import { describe, expect, it } from 'vitest';
import type { Stats } from '@/app/admin/stats/aggregate';
import { buildStatsRows } from '@/app/admin/stats/rows';
import { admin, builder, common } from '@/content/ar';
import type { DeviceKind, TrafficSource } from '@/lib/types';

const S = admin.stats;
const A = S.audience;

const emptySlots = (n: number) => Array.from({ length: n }, () => ({ visitors: 0, orders: 0 }));

/** A Stats object with nothing in it; `over` fills in what a test is about. */
const stats = (over: Partial<Stats> = {}): Stats => ({
  days: 30,
  hasData: true,
  visits: 0,
  visitorsToday: 0,
  uploads: 0,
  orders: 0,
  uploadToOrderPct: null,
  visitToOrderPct: null,
  revenueIqd: 0,
  avgOrderIqd: null,
  avgSheets: null,
  installs: 0,
  funnel: [],
  daily: [],
  sources: [],
  devices: [],
  cities: [],
  governorates: [],
  materials: [],
  shapes: [],
  sizes: [],
  weekdays: emptySlots(7),
  hours: emptySlots(24),
  newCustomers: 0,
  returningCustomers: 0,
  ...over,
});

/** 24 hour slots; `set` maps an hour to its [visitors, orders]. */
const hoursWith = (set: Record<number, [number, number]>) => {
  const hours = emptySlots(24);
  for (const [hour, [visitors, orders]] of Object.entries(set)) hours[Number(hour)] = { visitors, orders };
  return hours;
};

describe('buildStatsRows: devices', () => {
  it('each device carries its share of all devices as a note', () => {
    const { deviceRows } = buildStatsRows(
      stats({
        devices: [
          { key: 'mobile', count: 2 },
          { key: 'desktop', count: 1 },
        ],
      }),
    );
    expect(deviceRows).toEqual([
      { label: S.devices.mobile, value: 2, note: '66.7%' },
      { label: S.devices.desktop, value: 1, note: '33.3%' },
    ]);
  });

  it('a single device is 100%, and a zero total gives 0% instead of nothing', () => {
    expect(buildStatsRows(stats({ devices: [{ key: 'tablet', count: 5 }] })).deviceRows).toEqual([
      { label: S.devices.tablet, value: 5, note: '100%' },
    ]);
    expect(buildStatsRows(stats({ devices: [{ key: 'mobile', count: 0 }] })).deviceRows).toEqual([
      { label: S.devices.mobile, value: 0, note: '0%' },
    ]);
  });
});

describe('buildStatsRows: busiest hours', () => {
  it('keeps the 6 busiest hours with visitors, busiest first; equal hours stay in clock order', () => {
    const { hourRows } = buildStatsRows(
      stats({
        hours: hoursWith({ 0: [1, 0], 3: [5, 0], 9: [5, 0], 10: [7, 0], 11: [2, 0], 12: [2, 0], 13: [2, 0], 20: [0, 4] }),
      }),
    );
    expect(hourRows.map((r) => r.label)).toEqual(
      ['10:00', '03:00', '09:00', '11:00', '12:00', '13:00'].map((h) => `${S.hourLabel} ${h}`),
    );
    expect(hourRows.map((r) => r.value)).toEqual([7, 5, 5, 2, 2, 2]);
  });

  it('hours without visitors are left out, even when they have orders', () => {
    const { hourRows } = buildStatsRows(stats({ hours: hoursWith({ 8: [3, 0], 20: [0, 4], 23: [1, 0] }) }));
    expect(hourRows).toEqual([
      { label: `${S.hourLabel} 08:00`, value: 3, note: undefined },
      { label: `${S.hourLabel} 23:00`, value: 1, note: undefined },
    ]);
    expect(buildStatsRows(stats()).hourRows).toEqual([]);
  });

  it('the orders note is there only when the hour has orders', () => {
    const { hourRows } = buildStatsRows(stats({ hours: hoursWith({ 14: [4, 2], 15: [3, 0] }) }));
    expect(hourRows).toEqual([
      { label: `${S.hourLabel} 14:00`, value: 4, note: `2 ${A.ordersLabel}` },
      { label: `${S.hourLabel} 15:00`, value: 3, note: undefined },
    ]);
  });
});

describe('buildStatsRows: weekdays', () => {
  it('always seven rows, Saturday first, with the orders note only when the day has orders', () => {
    const weekdays = emptySlots(7);
    weekdays[0] = { visitors: 3, orders: 2 };
    weekdays[1] = { visitors: 1, orders: 0 };
    weekdays[6] = { visitors: 0, orders: 1 };
    const { weekdayRows } = buildStatsRows(stats({ weekdays }));
    expect(weekdayRows.map((r) => r.label)).toEqual([...S.weekdays]);
    expect(weekdayRows.map((r) => r.value)).toEqual([3, 1, 0, 0, 0, 0, 0]);
    expect(weekdayRows.map((r) => r.note)).toEqual([
      `2 ${A.ordersLabel}`,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      `1 ${A.ordersLabel}`,
    ]);
  });
});

describe('buildStatsRows: labels', () => {
  it('known keys get their Arabic label', () => {
    const rows = buildStatsRows(
      stats({
        sources: [
          { key: 'instagram', count: 4 },
          { key: 'direct', count: 1 },
        ],
        materials: [
          { key: 'paper', count: 3 },
          { key: 'plastic', count: 2 },
        ],
        shapes: [
          { key: 'circle', count: 3 },
          { key: 'rect', count: 2 },
          { key: 'custom', count: 1 },
        ],
      }),
    );
    expect(rows.sourceRows).toEqual([
      { label: S.sources.instagram, value: 4 },
      { label: S.sources.direct, value: 1 },
    ]);
    expect(rows.materialRows).toEqual([
      { label: common.materials.paper, value: 3 },
      { label: common.materials.plastic, value: 2 },
    ]);
    expect(rows.shapeRows).toEqual([
      { label: builder.shape.circle, value: 3 },
      { label: builder.shape.rect, value: 2 },
      { label: builder.shape.custom, value: 1 },
    ]);
  });

  it('unknown keys fall back to the key itself; an unknown source falls back to "other"', () => {
    const rows = buildStatsRows(
      stats({
        sources: [{ key: 'newsletter' as TrafficSource, count: 2 }],
        devices: [{ key: 'tv' as DeviceKind, count: 1 }],
        materials: [{ key: 'vinyl', count: 1 }],
        shapes: [
          { key: 'hexagon', count: 2 },
          { key: 'toString', count: 1 },
        ],
      }),
    );
    expect(rows.sourceRows).toEqual([{ label: S.sources.other, value: 2 }]);
    expect(rows.deviceRows).toEqual([{ label: 'tv', value: 1, note: '100%' }]);
    expect(rows.materialRows).toEqual([{ label: 'vinyl', value: 1 }]);
    expect(rows.shapeRows).toEqual([
      { label: 'hexagon', value: 2 },
      { label: 'toString', value: 1 },
    ]);
  });

  it('a shape key takes any text builder.shape holds under it, inherited names never (as the page always did)', () => {
    const keys = [...Object.keys(builder.shape), 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', ''];
    const { shapeRows } = buildStatsRows(stats({ shapes: keys.map((key) => ({ key, count: 1 })) }));
    const copy: Record<string, unknown> = builder.shape;
    expect(shapeRows.map((r) => r.label)).toEqual(
      keys.map((key) => (Object.hasOwn(copy, key) && typeof copy[key] === 'string' && copy[key] ? copy[key] : key)),
    );
    expect(buildStatsRows(stats({ shapes: [{ key: 'rounded', count: 1 }] })).shapeRows).toEqual([
      { label: builder.shape.rounded, value: 1 },
    ]);
  });

  it('cities and governorates are shown as stored; sizes get the cm unit', () => {
    const rows = buildStatsRows(
      stats({
        cities: [{ key: 'Baghdad', count: 3 }],
        governorates: [{ key: 'Basra', count: 2 }],
        sizes: [
          { key: '4×4', count: 5 },
          { key: '4.5×3', count: 1 },
        ],
      }),
    );
    expect(rows.cityRows).toEqual([{ label: 'Baghdad', value: 3 }]);
    expect(rows.govRows).toEqual([{ label: 'Basra', value: 2 }]);
    expect(rows.sizeRows).toEqual([
      { label: `4×4 ${common.units.cm}`, value: 5 },
      { label: `4.5×3 ${common.units.cm}`, value: 1 },
    ]);
  });

  it('customers: new first, then returning', () => {
    expect(buildStatsRows(stats({ newCustomers: 7, returningCustomers: 2 })).customerRows).toEqual([
      { label: A.newCustomers, value: 7 },
      { label: A.returningCustomers, value: 2 },
    ]);
  });

  it('nothing to show gives empty lists (the page then prints its "no data" line)', () => {
    const rows = buildStatsRows(stats());
    expect(rows.sourceRows).toEqual([]);
    expect(rows.deviceRows).toEqual([]);
    expect(rows.cityRows).toEqual([]);
    expect(rows.govRows).toEqual([]);
    expect(rows.materialRows).toEqual([]);
    expect(rows.shapeRows).toEqual([]);
    expect(rows.sizeRows).toEqual([]);
    expect(rows.weekdayRows).toHaveLength(7);
  });
});
