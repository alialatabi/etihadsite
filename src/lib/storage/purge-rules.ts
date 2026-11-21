import { KEEP_DESIGNS_FROM, PURGE_WINDOW_DAYS } from "../../config/defaults";

const DAY_MS = 86_400_000;

/** Retention bounds shared by both adapters' purgeOlderThan. Throws when KEEP_DESIGNS_FROM is malformed (fail safe: nothing may run without it). */
export function purgeBounds(cutoff: Date): { windowStart: Date; oldRuleEnd: Date; inWindow: (d: Date) => boolean } {
  const keepFrom = new Date(KEEP_DESIGNS_FROM);
  if (Number.isNaN(keepFrom.getTime())) throw new Error("bad KEEP_DESIGNS_FROM");
  const windowStart = new Date(cutoff.getTime() - PURGE_WINDOW_DAYS * DAY_MS);
  const oldRuleEnd = keepFrom < cutoff ? keepFrom : cutoff;
  return { windowStart, oldRuleEnd, inWindow: (d) => d >= windowStart && d < cutoff };
}
