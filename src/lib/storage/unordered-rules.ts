/**
 * Rules of the 7-day design retention (owner 2026-11-26), shared by both adapters. Relative imports only and no
 * `server-only`: scripts/purge-orders.ts loads this through storage/local.ts under tsx.
 */
import { UNORDERED_DESIGN_DAYS } from "../../config/defaults";

const DAY_MS = 86_400_000;
/** Clock slack between the caller computing `now − 7 days` and the guard running. */
const CUTOFF_TOLERANCE_MS = 5 * 60_000;

/**
 * The deletion of unordered designs is irreversible, so a cutoff that is not a valid date, or that is later than
 * now − UNORDERED_DESIGN_DAYS (plus a few minutes), is refused: a bug in a caller can never delete a fresh design.
 */
export function assertUnorderedCutoff(cutoff: Date, now: number = Date.now()): void {
  if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) throw new Error("Invalid purge cutoff");
  if (cutoff.getTime() > now - UNORDERED_DESIGN_DAYS * DAY_MS + CUTOFF_TOLERANCE_MS) {
    throw new Error(`Purge cutoff is newer than ${UNORDERED_DESIGN_DAYS} days: refused`);
  }
}

/**
 * Every upload path an order's files point at: `designPath` AND every `designPaths` entry (a union, unlike
 * designPathsOf, so no spelling of the record can hide a used upload). Non-string entries are ignored.
 */
export function allDesignPaths(files: { designPath?: unknown; designPaths?: unknown } | null | undefined): string[] {
  const out = new Set<string>();
  if (!files || typeof files !== "object") return [];
  if (typeof files.designPath === "string" && files.designPath) out.add(files.designPath);
  if (Array.isArray(files.designPaths)) for (const p of files.designPaths) if (typeof p === "string" && p) out.add(p);
  return [...out];
}
