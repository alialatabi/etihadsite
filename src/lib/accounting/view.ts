/** What the accounts page and its CSV export show for one chosen week. Pure except `loadAccountsView`. */
import type { OrderRecord, SheetCostEntry, StorageAdapter } from '@/lib/types';
import { bucketByWeek, computeWeek, type WeekFigures } from './compute';
import { addWeeks, parseWeekKey, weekKeyOf, weekRange } from './week';

/** Weeks in the history table (the current one included). */
export const HISTORY_WEEKS = 12;

export interface HistoryRow {
  key: string;
  orders: number;
  sheets: number;
  salesIqd: number;
  costIqd: number | null;
  profitIqd: number | null;
}

export interface AccountsView {
  /** The chosen week (a Saturday key); never in the future. */
  weekKey: string;
  currentWeekKey: string;
  isCurrent: boolean;
  week: WeekFigures;
  previous: WeekFigures;
  history: HistoryRow[];
  historyTotal: Omit<HistoryRow, 'key'>;
}

/** `?week=` → the week to show: invalid or in the future falls back to the current week. */
export function resolveWeek(param: unknown, now: Date): string {
  const current = weekKeyOf(now);
  const key = parseWeekKey(Array.isArray(param) ? param[0] : param);
  return key !== null && key <= current ? key : current;
}

/**
 * The span ONE query must cover: the HISTORY_WEEKS weeks ending with the current one plus the week
 * before them (for the oldest week's neighbour), widened to include the chosen week and the week
 * before it when `?week=` is older than that.
 */
export function viewSpan(weekKey: string, now: Date): { fromIso: string; toIso: string } {
  const current = weekKeyOf(now);
  const startKey = [addWeeks(current, -HISTORY_WEEKS), addWeeks(weekKey, -1)].sort()[0];
  return { fromIso: weekRange(startKey).fromIso, toIso: weekRange(current).toIso };
}

export function buildAccountsView(orders: readonly OrderRecord[], sheetCosts: readonly SheetCostEntry[], weekKey: string, now: Date): AccountsView {
  const currentWeekKey = weekKeyOf(now);
  const buckets = bucketByWeek(orders);
  const figures = (key: string) => computeWeek(buckets.get(key) ?? [], sheetCosts);
  const week = figures(weekKey);
  const previous = figures(addWeeks(weekKey, -1));

  const history: HistoryRow[] = [];
  const total = { orders: 0, sheets: 0, salesIqd: 0, costIqd: sheetCosts.length === 0 ? null : 0, profitIqd: sheetCosts.length === 0 ? null : 0 } as Omit<HistoryRow, 'key'>;
  for (let i = HISTORY_WEEKS - 1; i >= 0; i--) {
    const key = addWeeks(currentWeekKey, -i);
    const f = key === weekKey ? week : figures(key);
    history.push({ key, orders: f.ordersCount, sheets: f.sheets.total, salesIqd: f.salesIqd, costIqd: f.costIqd, profitIqd: f.profitIqd });
    total.orders += f.ordersCount;
    total.sheets += f.sheets.total;
    total.salesIqd += f.salesIqd;
    if (total.costIqd !== null && f.costIqd !== null) total.costIqd += f.costIqd;
    if (total.profitIqd !== null && f.profitIqd !== null) total.profitIqd += f.profitIqd;
  }
  return { weekKey, currentWeekKey, isCurrent: weekKey === currentWeekKey, week, previous, history, historyTotal: total };
}

/** One listOrdersBetween over the whole span, then the view. */
export async function loadAccountsView(storage: Pick<StorageAdapter, 'listOrdersBetween'>, sheetCosts: readonly SheetCostEntry[], weekKey: string, now: Date): Promise<AccountsView> {
  const { fromIso, toIso } = viewSpan(weekKey, now);
  return buildAccountsView(await storage.listOrdersBetween(fromIso, toIso), sheetCosts, weekKey, now);
}
