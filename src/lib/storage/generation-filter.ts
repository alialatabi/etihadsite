/**
 * Filter of the admin designs gallery (AiGenerationFilter), shared by both adapters. Pure, relative imports only
 * (scripts load it through storage/local.ts under tsx).
 *
 * `resolveGenerationFilter` validates every value; an invalid value gives null = "no rows" (the adapters then
 * answer an empty page without a request). The Supabase adapter turns the resolved filter into PostgREST
 * parameters (`generationFilterQuery`), the local one tests rows in memory (`matchesGenerationFilter`).
 */
import type { AiGenerationFilter, AiGenerationRecord } from "../types";
import { ID_RE } from "./paths";

/** Longest search text used; the rest is cut. */
export const SEARCH_TEXT_MAX = 100;
/** Most order ids used by one search; the rest is dropped. */
export const SEARCH_ORDER_IDS_MAX = 200;
const SHAPES: readonly string[] = ["circle", "rect", "custom"];

export interface ResolvedGenerationFilter {
  ipKey?: string;
  ordered?: boolean;
  maker?: "customer" | "staff" | { staffId: string };
  shape?: string;
  since?: Date;
  until?: Date;
  search?: { text: string; orderIds: string[] };
}

/** A lone UTF-16 surrogate (cannot be percent-encoded: encodeURIComponent throws on it). */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Control characters and lone surrogates become spaces; trimmed and cut to SEARCH_TEXT_MAX CHARACTERS (code points,
 * so an emoji is never cut in half).
 */
function cleanSearchText(raw: unknown): string {
  const clean = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(LONE_SURROGATE_RE, " ");
  return Array.from(clean.trim()).slice(0, SEARCH_TEXT_MAX).join("").trim();
}

function encodable(s: string): boolean {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
}

/** Strict ISO 8601 date-time with a zone: `Z` or an explicit `±HH:MM` offset (the admin page sends toISOString()). */
const ISO_DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Absent → undefined; a valid strict ISO 8601 instant (zone required, year 1..9999) → Date; anything else → null
 * (the filter then yields no rows). `new Date("1")` or a zone-less string would otherwise depend on the server's time zone.
 */
function parseDate(v: unknown): Date | null | undefined {
  if (v === undefined || v === null || v === "") return undefined; // absent
  if (typeof v !== "string" || v.length > 40) return null;
  const m = ISO_DATE_TIME_RE.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1 || year > 9999) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The validated filter, or null when a given value is invalid or the search can match nothing (then no rows). */
export function resolveGenerationFilter(f: AiGenerationFilter): ResolvedGenerationFilter | null {
  const out: ResolvedGenerationFilter = {};
  if (f.ipKey !== undefined) {
    if (typeof f.ipKey !== "string" || !encodable(f.ipKey)) return null;
    out.ipKey = f.ipKey;
  }
  if (f.ordered !== undefined) {
    if (typeof f.ordered !== "boolean") return null;
    out.ordered = f.ordered;
  }
  if (f.maker !== undefined) {
    if (f.maker === "customer" || f.maker === "staff") out.maker = f.maker;
    else if (typeof f.maker === "object" && f.maker !== null && typeof f.maker.staffId === "string" && ID_RE.test(f.maker.staffId)) {
      out.maker = { staffId: f.maker.staffId };
    } else return null;
  }
  if (f.shape !== undefined) {
    if (typeof f.shape !== "string" || !SHAPES.includes(f.shape)) return null;
    out.shape = f.shape;
  }
  const since = parseDate(f.since);
  if (since === null) return null;
  if (since) out.since = since;
  const until = parseDate(f.until);
  if (until === null) return null;
  if (until) out.until = until;
  if (f.search !== undefined) {
    const text = cleanSearchText(f.search?.text);
    const ids = Array.isArray(f.search?.orderIds) ? f.search.orderIds : [];
    const orderIds = [...new Set(ids.filter((i): i is string => typeof i === "string" && ID_RE.test(i)))].slice(0, SEARCH_ORDER_IDS_MAX);
    if (text === "" && orderIds.length === 0) return null;
    out.search = { text, orderIds };
  }
  return out;
}

/**
 * Text of an ilike pattern: the characters that are special to PostgREST's quoted values and to LIKE
 * (`\` `"` `*` `%`) are replaced by `_`, the one-character wildcard of LIKE. So the pattern can never carry an
 * escape, a quote or a wildcard of its own (a literal one is matched as "any one character"), and no escaping
 * layer can be wrong. `_` itself stays (it is already a one-character wildcard).
 */
function ilikeText(text: string): string {
  return text.replace(/[\\"*%]/g, "_");
}

/**
 * PostgREST query-string part (starts with `&`, may be empty) of a resolved filter. Every value is validated
 * or percent-encoded; the whole `or=(…)` value is encoded as one (so `&`, `#`, `+`, `=` cannot leave it).
 * The values inside `or=()` are double-quoted (`, ( ) . :` are plain characters there); order ids are only
 * ID_RE characters.
 */
export function generationFilterQuery(r: ResolvedGenerationFilter): string {
  let qs = "";
  if (r.ipKey !== undefined) qs += `&ip_key=eq.${encodeURIComponent(r.ipKey)}`;
  if (r.ordered !== undefined) qs += r.ordered ? "&order_id=not.is.null" : "&order_id=is.null";
  if (r.maker === "customer") qs += "&staff_id=is.null";
  else if (r.maker === "staff") qs += "&staff_id=not.is.null";
  else if (r.maker) qs += `&staff_id=eq.${encodeURIComponent(r.maker.staffId)}`;
  if (r.shape !== undefined) qs += `&shape=eq.${encodeURIComponent(r.shape)}`;
  if (r.since) qs += `&created_at=gte.${encodeURIComponent(r.since.toISOString())}`;
  if (r.until) qs += `&created_at=lt.${encodeURIComponent(r.until.toISOString())}`;
  if (r.search) {
    const clauses: string[] = [];
    if (r.search.text !== "") {
      const pat = `"*${ilikeText(r.search.text)}*"`;
      clauses.push(`idea.ilike.${pat}`, `instructions.ilike.${pat}`);
    }
    if (r.search.orderIds.length > 0) clauses.push(`order_id.in.(${r.search.orderIds.map((i) => `"${i}"`).join(",")})`);
    qs += `&or=${encodeURIComponent(`(${clauses.join(",")})`)}`;
  }
  return qs;
}

/** In-memory twin of generationFilterQuery for the local adapter (text: case-insensitive substring of idea or instructions). */
export function matchesGenerationFilter(g: AiGenerationRecord, r: ResolvedGenerationFilter): boolean {
  if (r.ipKey !== undefined && g.ipKey !== r.ipKey) return false;
  if (r.ordered !== undefined && (g.orderId != null) !== r.ordered) return false;
  if (r.maker === "customer" && g.staffId != null) return false;
  if (r.maker === "staff" && g.staffId == null) return false;
  if (r.maker && typeof r.maker === "object" && g.staffId !== r.maker.staffId) return false;
  if (r.shape !== undefined && g.shape !== r.shape) return false;
  if (r.since || r.until) {
    const t = new Date(g.createdAt).getTime();
    if (Number.isNaN(t)) return false;
    if (r.since && t < r.since.getTime()) return false;
    if (r.until && t >= r.until.getTime()) return false;
  }
  if (r.search) {
    const needle = r.search.text.toLowerCase();
    const byText =
      needle !== "" && (String(g.idea ?? "").toLowerCase().includes(needle) || String(g.instructions ?? "").toLowerCase().includes(needle));
    const byOrder = g.orderId != null && r.search.orderIds.includes(g.orderId);
    if (!byText && !byOrder) return false;
  }
  return true;
}
