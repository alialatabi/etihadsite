/** Which cost per A4 sheet applies to an order. Pure. */
import type { Material, SheetCostEntry } from '@/lib/types';

/**
 * The cost of one sheet of `material` for an order created at `createdAtIso`: the entry with the latest
 * `from` that is not after the order. An order older than the FIRST entry uses that first entry (the
 * first cost the owner enters also applies to earlier orders). No entries (or an unreadable date): null,
 * which the UI shows as "cost not set", never as 0.
 */
export function costAt(entries: readonly SheetCostEntry[], createdAtIso: string, material: Material): number | null {
  const at = Date.parse(createdAtIso);
  if (Number.isNaN(at)) return null;
  let earliest: { t: number; e: SheetCostEntry } | null = null;
  let best: { t: number; e: SheetCostEntry } | null = null;
  for (const e of entries) {
    const t = Date.parse(e.from);
    if (Number.isNaN(t)) continue;
    if (earliest === null || t < earliest.t) earliest = { t, e };
    if (t <= at && (best === null || t >= best.t)) best = { t, e };
  }
  const pick = best ?? earliest;
  if (!pick) return null;
  return material === 'paper' ? pick.e.paperIqd : pick.e.plasticIqd;
}

/** The entry in force right now (the latest `from`), or null with no entries. */
export function currentCost(entries: readonly SheetCostEntry[]): SheetCostEntry | null {
  let best: { t: number; e: SheetCostEntry } | null = null;
  for (const e of entries) {
    const t = Date.parse(e.from);
    if (!Number.isNaN(t) && (best === null || t >= best.t)) best = { t, e };
  }
  return best?.e ?? null;
}
