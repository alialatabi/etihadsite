import { describe, expect, it } from 'vitest';
import { bucketByWeek, changePercent, computeWeek } from '@/lib/accounting/compute';
import type { SheetCostEntry } from '@/lib/types';
import { makeOrder } from './fixtures';

const COSTS: SheetCostEntry[] = [{ from: '2026-11-01T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 }];
// Week of Saturday 2026-11-21 (Baghdad).
const SAT = '2026-11-21T09:00:00+03:00';
const SUN = '2026-11-22T09:00:00+03:00';
const THU = '2026-11-26T09:00:00+03:00';

describe('computeWeek', () => {
  const orders = [
    makeOrder({ id: 'o1', createdAt: SAT, material: 'paper', sheets: 10, unitBase: 1000, status: 'new' }),
    makeOrder({ id: 'o2', createdAt: SUN, material: 'plastic', sheets: 4, unitBase: 2000, discountPercent: 10, status: 'done' }),
    makeOrder({ id: 'o3', createdAt: THU, material: 'paper', sheets: 5, unitBase: null, status: 'printing' }),
    makeOrder({ id: 'o4', createdAt: THU, material: 'paper', sheets: 100, status: 'cancelled' }),
  ];
  const w = computeWeek(orders, COSTS);

  it('counts every order that is not cancelled, in every status', () => {
    expect(w.ordersCount).toBe(3);
    expect(w.cancelledCount).toBe(1);
    expect(w.byStatus).toEqual({ new: 1, printing: 1, done: 1 });
  });

  it('sheets and stickers cover all counted orders (also the unpriced one), never the cancelled one', () => {
    expect(w.sheets).toEqual({ total: 19, paper: 15, plastic: 4 });
    expect(w.stickers).toBe(19 * 54);
  });

  it('an order without a price is counted apart and is in no money figure (null is not 0)', () => {
    expect(w.unpricedCount).toBe(1);
    expect(w.salesIqd).toBe(15000 + 12200);
    expect(w.sheetSalesIqd).toBe(10000 + 7200);
    expect(w.deliveryIqd).toBe(10000);
    const row = w.rows.find((r) => r.orderId === 'o3')!;
    expect(row).toMatchObject({ counted: true, salesIqd: null, costIqd: null, profitIqd: null });
    // The 5 unpriced sheets are not costed either.
    expect(w.costIqd).toBe(10 * 300 + 4 * 500);
  });

  it('discount = (base - discounted unit price) x sheets over priced orders', () => {
    expect(w.discountIqd).toBe((2000 - 1800) * 4);
  });

  it('profit = price of the sheets - cost, delivery fees are NOT in it', () => {
    expect(w.profitIqd).toBe(17200 - 5000);
    expect(w.profitIqd).not.toBe(w.salesIqd - 5000);
    expect(w.marginPercent).toBe(70.9);
  });

  it('two materials: each row has its own numbers', () => {
    const paper = w.byMaterial.find((m) => m.material === 'paper')!;
    const plastic = w.byMaterial.find((m) => m.material === 'plastic')!;
    expect(paper).toMatchObject({ orders: 2, sheets: 15, salesIqd: 15000, sheetSalesIqd: 10000, costIqd: 3000, profitIqd: 7000 });
    expect(plastic).toMatchObject({ orders: 1, sheets: 4, salesIqd: 12200, sheetSalesIqd: 7200, costIqd: 2000, profitIqd: 5200 });
  });

  it('seven day rows Saturday..Friday', () => {
    expect(w.byDay.map((d) => d.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(w.byDay[0]).toMatchObject({ orders: 1, sheets: 10, salesIqd: 15000, profitIqd: 7000 });
    expect(w.byDay[1]).toMatchObject({ orders: 1, sheets: 4, salesIqd: 12200, profitIqd: 5200 });
    expect(w.byDay[5]).toMatchObject({ orders: 1, sheets: 5, salesIqd: 0, profitIqd: 0 });
    expect(w.byDay[6].orders).toBe(0);
  });

  it('rows: one per order including the cancelled one, whose money is null', () => {
    expect(w.rows).toHaveLength(4);
    expect(w.rows.find((r) => r.orderId === 'o1')).toMatchObject({ salesIqd: 15000, costIqd: 3000, profitIqd: 7000, stickers: 540, displayNo: 'EP-o1' });
    expect(w.rows.find((r) => r.orderId === 'o4')).toMatchObject({ counted: false, salesIqd: null, costIqd: null, profitIqd: null });
  });

  it('cost not set: costMissing, and profit is null instead of profit = sales', () => {
    const none = computeWeek(orders, []);
    expect(none.costMissing).toBe(true);
    expect(none.costIqd).toBeNull();
    expect(none.profitIqd).toBeNull();
    expect(none.marginPercent).toBeNull();
    expect(none.salesIqd).toBe(27200);
    expect(none.byMaterial.every((m) => m.costIqd === null && m.profitIqd === null)).toBe(true);
    expect(none.byDay.every((d) => d.profitIqd === null)).toBe(true);
    expect(none.rows.every((r) => r.costIqd === null && r.profitIqd === null)).toBe(true);
  });

  it('an empty week is all zeros, a null margin and no crash', () => {
    const e = computeWeek([], COSTS);
    expect(e).toMatchObject({ ordersCount: 0, salesIqd: 0, costIqd: 0, profitIqd: 0, marginPercent: null, unpricedCount: 0 });
  });

  it('uses the cost in force when each order was created', () => {
    const costs: SheetCostEntry[] = [
      { from: '2026-11-01T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 },
      { from: '2026-11-22T00:00:00.000Z', paperIqd: 400, plasticIqd: 500 },
    ];
    const r = computeWeek(orders, costs);
    expect(r.rows.find((x) => x.orderId === 'o1')!.costIqd).toBe(3000); // Saturday: before the change
    expect(r.rows.find((x) => x.orderId === 'o2')!.costIqd).toBe(2000);
  });
});

describe('changePercent', () => {
  it('one decimal; null with nothing to compare against', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(100, 300)).toBe(-66.7);
    expect(changePercent(10, 0)).toBeNull();
    expect(changePercent(null, 10)).toBeNull();
    expect(changePercent(10, null)).toBeNull();
  });
});

describe('bucketByWeek', () => {
  it('groups by the Saturday key, with Friday 20:59:59Z and 21:00:00Z in different weeks', () => {
    const a = makeOrder({ createdAt: '2026-11-27T20:59:59.000Z' });
    const b = makeOrder({ createdAt: '2026-11-27T21:00:00.000Z' });
    const m = bucketByWeek([a, b]);
    expect(m.get('2026-11-21')).toEqual([a]);
    expect(m.get('2026-11-28')).toEqual([b]);
  });
});
