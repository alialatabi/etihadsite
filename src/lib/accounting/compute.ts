/**
 * Weekly accounting figures from stored orders. Pure (no I/O).
 *
 * Rules (owner decisions):
 * - Sold = every order whose status is not 'cancelled' (new, printing and done all count).
 * - Prices are the STORED ones (record.price); nothing is re-priced. An order whose totalIqd is null has no
 *   price yet: it counts in orders, sheets and stickers, but NEVER in any money figure (null is not 0).
 * - Cost = sheets x the cost per sheet of its material (costAt). Delivery fees are not in the profit:
 *   profit = what the sheets sold for (price.subtotalIqd) - cost; delivery is its own line.
 * - An order saved in an older price format (no material and/or no sheets) is read through orderPriceView and
 *   treated like an unpriced one: it counts in orders (and in the sheet / material / sticker figures for what it
 *   does have) but in no money figure, because its cost cannot be worked out. Nothing here throws on it.
 * - No cost entered at all: costMissing, and cost / profit / margin are null (never profit = sales).
 */
import { orderPriceView } from '@/lib/order-price-view';
import type { Material, OrderRecord, OrderStatus, PriceBreakdown, SheetCostEntry } from '@/lib/types';
import { costAt } from './costs';
import { dayIndex, weekKeyOf } from './week';

export const MATERIALS = ['paper', 'plastic'] as const satisfies readonly Material[];

export interface OrderRow {
  orderId: string;
  displayNo: string;
  createdAt: string;
  status: OrderStatus;
  /** Null on an order saved in an older price format. */
  material: Material | null;
  sheets: number | null;
  stickers: number;
  /** False for a cancelled order: its money is null and it is in no total. */
  counted: boolean;
  /** What the customer pays (price.totalIqd, delivery included); null when unpriced or cancelled. */
  salesIqd: number | null;
  costIqd: number | null;
  /** price.subtotalIqd - costIqd; null when unpriced, cancelled or no cost is set. */
  profitIqd: number | null;
}

export interface MaterialRow {
  material: Material;
  orders: number;
  sheets: number;
  stickers: number;
  salesIqd: number;
  sheetSalesIqd: number;
  costIqd: number | null;
  profitIqd: number | null;
}

export interface DayRow {
  /** 0 = Saturday .. 6 = Friday. */
  day: number;
  orders: number;
  sheets: number;
  stickers: number;
  salesIqd: number;
  profitIqd: number | null;
}

export interface WeekFigures {
  /** Counted (not cancelled) orders. */
  ordersCount: number;
  cancelledCount: number;
  byStatus: { new: number; printing: number; done: number };
  sheets: { total: number; paper: number; plastic: number };
  stickers: number;
  /** Counted orders without a price: in the counts above, in no money figure below. */
  unpricedCount: number;
  salesIqd: number;
  sheetSalesIqd: number;
  deliveryIqd: number;
  discountIqd: number;
  costIqd: number | null;
  costMissing: boolean;
  profitIqd: number | null;
  marginPercent: number | null;
  byMaterial: MaterialRow[];
  byDay: DayRow[];
  rows: OrderRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Percent change from `previous` to `current`, one decimal; null when there is nothing to compare with. */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

export function computeWeek(orders: readonly OrderRecord[], sheetCosts: readonly SheetCostEntry[]): WeekFigures {
  const costMissing = sheetCosts.length === 0;
  const byStatus = { new: 0, printing: 0, done: 0 };
  const sheets = { total: 0, paper: 0, plastic: 0 };
  let stickers = 0;
  let ordersCount = 0;
  let cancelledCount = 0;
  let unpricedCount = 0;
  let salesIqd = 0;
  let sheetSalesIqd = 0;
  let deliveryIqd = 0;
  let discountIqd = 0;
  let costSum = 0;

  const mat = new Map<Material, MaterialRow>(
    MATERIALS.map((m) => [m, { material: m, orders: 0, sheets: 0, stickers: 0, salesIqd: 0, sheetSalesIqd: 0, costIqd: costMissing ? null : 0, profitIqd: costMissing ? null : 0 }]),
  );
  const days: DayRow[] = Array.from({ length: 7 }, (_, day) => ({
    day,
    orders: 0,
    sheets: 0,
    stickers: 0,
    salesIqd: 0,
    profitIqd: costMissing ? null : 0,
  }));
  const rows: OrderRow[] = [];

  for (const o of orders) {
    const p = orderPriceView(o);
    const raw = (o as { price?: Partial<PriceBreakdown> }).price;
    const orderSheets = p.sheets;
    const orderStickers = p.totalStickers ?? 0;
    const base: Pick<OrderRow, 'orderId' | 'displayNo' | 'createdAt' | 'status' | 'material' | 'sheets' | 'stickers'> = {
      orderId: o.orderId,
      displayNo: o.displayNo,
      createdAt: o.createdAt,
      status: o.status,
      material: p.material,
      sheets: orderSheets,
      stickers: orderStickers,
    };
    if (o.status === 'cancelled') {
      cancelledCount++;
      rows.push({ ...base, counted: false, salesIqd: null, costIqd: null, profitIqd: null });
      continue;
    }
    ordersCount++;
    if (o.status === 'new' || o.status === 'printing' || o.status === 'done') byStatus[o.status]++;
    if (orderSheets !== null) {
      sheets.total += orderSheets;
      if (p.material !== null) sheets[p.material] += orderSheets;
    }
    stickers += orderStickers;
    const m = p.material === null ? undefined : mat.get(p.material);
    if (m) {
      m.orders++;
      m.sheets += orderSheets ?? 0;
      m.stickers += orderStickers;
    }
    const d = days[dayIndex(o.createdAt)];
    d.orders++;
    d.sheets += orderSheets ?? 0;
    d.stickers += orderStickers;

    // No price yet, or a record too old to work out its cost: in the counts above, in no money figure.
    if (p.totalIqd === null || p.material === null || orderSheets === null || !m) {
      unpricedCount++;
      rows.push({ ...base, counted: true, salesIqd: null, costIqd: null, profitIqd: null });
      continue;
    }
    const delivery = p.deliveryFeeIqd ?? 0;
    const subtotal = p.subtotalIqd ?? p.totalIqd - delivery;
    salesIqd += p.totalIqd;
    sheetSalesIqd += subtotal;
    deliveryIqd += delivery;
    const unitBase = raw?.unitBaseIqd ?? null;
    if (unitBase !== null && p.unitPriceIqd !== null) discountIqd += (unitBase - p.unitPriceIqd) * orderSheets;
    m.salesIqd += p.totalIqd;
    m.sheetSalesIqd += subtotal;
    d.salesIqd += p.totalIqd;

    let costIqd: number | null = null;
    let profitIqd: number | null = null;
    if (!costMissing) {
      const perSheet = costAt(sheetCosts, o.createdAt, p.material);
      if (perSheet !== null) {
        costIqd = orderSheets * perSheet;
        profitIqd = subtotal - costIqd;
        costSum += costIqd;
        m.costIqd = (m.costIqd ?? 0) + costIqd;
        m.profitIqd = (m.profitIqd ?? 0) + profitIqd;
        if (d.profitIqd !== null) d.profitIqd += profitIqd;
      }
    }
    rows.push({ ...base, counted: true, salesIqd: p.totalIqd, costIqd, profitIqd });
  }

  const costIqd = costMissing ? null : costSum;
  const profitIqd = costIqd === null ? null : sheetSalesIqd - costIqd;
  return {
    ordersCount,
    cancelledCount,
    byStatus,
    sheets,
    stickers,
    unpricedCount,
    salesIqd,
    sheetSalesIqd,
    deliveryIqd,
    discountIqd,
    costIqd,
    costMissing,
    profitIqd,
    marginPercent: profitIqd === null || sheetSalesIqd === 0 ? null : round1((profitIqd / sheetSalesIqd) * 100),
    byMaterial: [...mat.values()],
    byDay: days,
    rows,
  };
}

/** Orders grouped by the week they were created in (key = the Saturday, shop calendar). */
export function bucketByWeek(orders: readonly OrderRecord[]): Map<string, OrderRecord[]> {
  const out = new Map<string, OrderRecord[]>();
  for (const o of orders) {
    const key = weekKeyOf(new Date(o.createdAt));
    const list = out.get(key);
    if (list) list.push(o);
    else out.set(key, [o]);
  }
  return out;
}
