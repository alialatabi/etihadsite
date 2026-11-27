import { describe, expect, it, vi } from 'vitest';
import { buildAccountsView, HISTORY_WEEKS, loadAccountsView, resolveWeek, viewSpan } from '@/lib/accounting/view';
import { addWeeks, weekRange } from '@/lib/accounting/week';
import type { SheetCostEntry } from '@/lib/types';
import { makeOrder } from './fixtures';

const COSTS: SheetCostEntry[] = [{ from: '2026-01-01T00:00:00.000Z', paperIqd: 300, plasticIqd: 500 }];
// Wednesday 2026-11-25 (Baghdad): current week is Saturday 2026-11-21.
const NOW = new Date('2026-11-25T09:00:00+03:00');
const CURRENT = '2026-11-21';

describe('resolveWeek', () => {
  it('valid past Saturday and the current one are kept', () => {
    expect(resolveWeek('2026-11-14', NOW)).toBe('2026-11-14');
    expect(resolveWeek('2026-11-21', NOW)).toBe(CURRENT);
  });
  it('invalid, missing or future falls back to the current week', () => {
    expect(resolveWeek(undefined, NOW)).toBe(CURRENT);
    expect(resolveWeek('garbage', NOW)).toBe(CURRENT);
    expect(resolveWeek('2026-11-22', NOW)).toBe(CURRENT); // a Sunday
    expect(resolveWeek('2026-11-28', NOW)).toBe(CURRENT); // next Saturday: the future
    expect(resolveWeek('2030-01-05', NOW)).toBe(CURRENT);
  });
  it('takes the first of a repeated parameter', () => {
    expect(resolveWeek(['2026-11-14', 'x'], NOW)).toBe('2026-11-14');
  });
});

describe('viewSpan', () => {
  it('covers the 12 history weeks and the one before them, up to the end of the current week', () => {
    const { fromIso, toIso } = viewSpan(CURRENT, NOW);
    expect(fromIso).toBe(weekRange(addWeeks(CURRENT, -HISTORY_WEEKS)).fromIso);
    expect(toIso).toBe(weekRange(CURRENT).toIso);
  });
  it('widens to include an older chosen week and the week before it', () => {
    const old = addWeeks(CURRENT, -30);
    expect(viewSpan(old, NOW).fromIso).toBe(weekRange(addWeeks(old, -1)).fromIso);
  });
});

describe('buildAccountsView', () => {
  const orders = [
    makeOrder({ createdAt: '2026-11-14T10:00:00+03:00', sheets: 10 }), // previous week
    makeOrder({ createdAt: '2026-11-22T10:00:00+03:00', sheets: 20 }), // this week
    makeOrder({ createdAt: '2026-09-12T10:00:00+03:00', sheets: 5 }), // inside the 12 weeks
    makeOrder({ createdAt: '2026-06-01T10:00:00+03:00', sheets: 99 }), // older than the history
  ];
  const v = buildAccountsView(orders, COSTS, CURRENT, NOW);

  it('the chosen and the previous week come from the same orders', () => {
    expect(v.isCurrent).toBe(true);
    expect(v.week.sheets.total).toBe(20);
    expect(v.previous.sheets.total).toBe(10);
  });
  it('history has 12 rows ending with the current week, and totals over them', () => {
    expect(v.history).toHaveLength(HISTORY_WEEKS);
    expect(v.history[HISTORY_WEEKS - 1].key).toBe(CURRENT);
    expect(v.history[0].key).toBe(addWeeks(CURRENT, -11));
    expect(v.historyTotal.sheets).toBe(35);
    expect(v.historyTotal.orders).toBe(3);
  });
  it('an old chosen week still has its own figures and its previous week', () => {
    const w = buildAccountsView(orders, COSTS, '2026-09-12', NOW);
    expect(w.isCurrent).toBe(false);
    expect(w.week.sheets.total).toBe(5);
    expect(w.previous.sheets.total).toBe(0);
  });
  it('without a cost the history cost and profit are null, not 0', () => {
    const n = buildAccountsView(orders, [], CURRENT, NOW);
    expect(n.historyTotal.costIqd).toBeNull();
    expect(n.historyTotal.profitIqd).toBeNull();
    expect(n.history.every((h) => h.profitIqd === null)).toBe(true);
  });
});

describe('loadAccountsView', () => {
  it('makes exactly ONE storage call for the whole span', async () => {
    const listOrdersBetween = vi.fn(async () => [makeOrder({ createdAt: '2026-11-22T10:00:00+03:00' })]);
    const v = await loadAccountsView({ listOrdersBetween }, COSTS, CURRENT, NOW);
    expect(listOrdersBetween).toHaveBeenCalledTimes(1);
    expect(listOrdersBetween).toHaveBeenCalledWith(viewSpan(CURRENT, NOW).fromIso, viewSpan(CURRENT, NOW).toIso);
    expect(v.week.ordersCount).toBe(1);
  });
});
