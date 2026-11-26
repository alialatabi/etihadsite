/**
 * Query-string filters of the admin designs gallery and the order search behind its search box.
 * Pure (no I/O, no storage): the page feeds it `searchParams` and the newest orders.
 * Nothing in the URL is trusted: every value is validated, anything else is ignored.
 */
import { SHOP_TIME_ZONE } from '@/config/defaults';
import { normaliseDigits } from '@/lib/parse/digits';
import type { AiGenerationFilter, OrderRecord, Shape } from '@/lib/types';
import { IP_KEY_RE, pageFromParam } from './summary';

/** Longest search text kept (the rest is cut off). */
export const MAX_QUERY_LENGTH = 100;
/** Most order ids passed to storage as a search filter (it puts them in one URL / IN list). */
export const MAX_SEARCH_ORDER_IDS = 200;
/** Fewest digits of a phone search that count (a shorter run would match half of the orders). */
export const MIN_PHONE_DIGITS = 4;

export type StatusParam = '' | 'ordered' | 'unordered';
export const SHAPES: readonly Shape[] = ['circle', 'rect', 'custom'];

const STAFF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DesignFilters {
  /** The validated values, ready to put back in the form (and in pagination links). */
  echo: {
    q: string;
    status: StatusParam;
    /** '' | 'customer' | 'staff' | 'staff:<id>' */
    maker: string;
    shape: '' | Shape;
    from: string;
    to: string;
    ip: string;
  };
  /** What storage understands, WITHOUT `search` (the page adds it after matching orders). */
  filter: AiGenerationFilter;
  page: number;
  /** True when any filter or search is set (the unfiltered total is then fetched separately). */
  active: boolean;
}

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The UTC offset of SHOP_TIME_ZONE at `at`, in ms (Iraq has no daylight saving, but do not assume it). */
function shopOffsetMs(at: number): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: SHOP_TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(new Date(at))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = part ? /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part) : null;
  if (!m) return 0;
  const ms = (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
  return m[1] === '-' ? -ms : ms;
}

/** Start (ISO, UTC) of the shop calendar day y-mo-d; Date.UTC rolls an overflowing day into the next month. */
function dayStart(y: number, mo: number, d: number): string {
  const utc = Date.UTC(y, mo - 1, d);
  return new Date(utc - shopOffsetMs(utc)).toISOString();
}

/** The real calendar date in `YYYY-MM-DD`, or null for anything else (2026-02-31 is not a date). */
function realDay(day: string): [number, number, number] | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return [y, mo, d];
}

/** Start (ISO, UTC) of the shop calendar day `YYYY-MM-DD`; null for anything that is not a real date. */
export function shopDayStartIso(day: string): string | null {
  const p = realDay(day);
  return p ? dayStart(p[0], p[1], p[2]) : null;
}

/** First instant AFTER the shop day `YYYY-MM-DD` (= start of the next day); null when invalid. */
export function shopDayEndIso(day: string): string | null {
  const p = realDay(day);
  return p ? dayStart(p[0], p[1], p[2] + 1) : null;
}

/** Parses `/admin/designs?...`. Bad values are dropped, never thrown. */
export function parseDesignFilters(sp: Raw): DesignFilters {
  const qRaw = (first(sp.q) ?? '').replace(/\s+/g, ' ').trim();
  const q = qRaw.length > MAX_QUERY_LENGTH ? qRaw.slice(0, MAX_QUERY_LENGTH).trim() : qRaw;

  const statusRaw = first(sp.status);
  const status: StatusParam = statusRaw === 'ordered' || statusRaw === 'unordered' ? statusRaw : '';

  const makerRaw = first(sp.maker) ?? '';
  let maker = '';
  if (makerRaw === 'customer' || makerRaw === 'staff') maker = makerRaw;
  else if (makerRaw.startsWith('staff:') && STAFF_ID_RE.test(makerRaw.slice(6))) maker = makerRaw;

  const shapeRaw = first(sp.shape);
  const shape: '' | Shape = SHAPES.find((s) => s === shapeRaw) ?? '';

  const fromRaw = first(sp.from) ?? '';
  const toRaw = first(sp.to) ?? '';
  const since = shopDayStartIso(fromRaw);
  const until = shopDayEndIso(toRaw);
  const from = since ? fromRaw : '';
  const to = until ? toRaw : '';

  const ipRaw = first(sp.ip);
  const ipKey = ipRaw && IP_KEY_RE.test(ipRaw) ? ipRaw : undefined;

  const filter: AiGenerationFilter = {};
  if (ipKey) filter.ipKey = ipKey;
  if (status) filter.ordered = status === 'ordered';
  if (maker === 'customer') filter.maker = 'customer';
  else if (maker === 'staff') filter.maker = 'staff';
  else if (maker.startsWith('staff:')) filter.maker = { staffId: maker.slice(6) };
  if (shape) filter.shape = shape;
  if (since) filter.since = since;
  if (until) filter.until = until;

  return {
    echo: { q, status, maker, shape, from, to, ip: ipKey ?? '' },
    filter,
    page: pageFromParam(first(sp.page)),
    active: q !== '' || Object.keys(filter).length > 0,
  };
}

/** The query string (no leading `?`) that reproduces `f`, optionally on another page. */
export function filterQuery(f: DesignFilters['echo'], page = 1): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.status) p.set('status', f.status);
  if (f.maker) p.set('maker', f.maker);
  if (f.shape) p.set('shape', f.shape);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.ip) p.set('ip', f.ip);
  if (page > 1) p.set('page', String(page));
  return p.toString();
}

/**
 * The digits of a phone search without the country prefix: "0770 123", "+964 770 123" and
 * "٠٧٧٠١٢٣" all give "770123". Fewer than MIN_PHONE_DIGITS digits gives '' (no phone match).
 */
export function phoneSearchDigits(q: string): string {
  let d = normaliseDigits(q).replace(/\D/g, '');
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  return d.length >= MIN_PHONE_DIGITS ? d : '';
}

/** What matchOrderIds found. */
export interface OrderMatch {
  /** Newest first, no duplicates, at most MAX_SEARCH_ORDER_IDS. */
  ids: string[];
  /** True when more orders matched than MAX_SEARCH_ORDER_IDS: the oldest matches are not searched. */
  truncated: boolean;
}

/**
 * The orders whose customer name or order number contains `q` (case-insensitive) or whose phone contains its
 * digits. `q` is digit-normalised first (٠١٢ = 012), so an order number typed with Arabic-Indic digits matches too.
 * Newest first, at most MAX_SEARCH_ORDER_IDS ids, no duplicates; `truncated` says the cap cut matches off.
 */
export function matchOrderIds(
  q: string,
  orders: ReadonlyArray<Pick<OrderRecord, 'orderId' | 'displayNo' | 'createdAt' | 'customer'>>,
): OrderMatch {
  const text = normaliseDigits(q).trim().toLowerCase();
  if (!text) return { ids: [], truncated: false };
  const digits = phoneSearchDigits(q);
  const hits = orders.filter((o) => {
    if (normaliseDigits(o.customer.name ?? '').toLowerCase().includes(text)) return true;
    if (o.displayNo.toLowerCase().includes(text)) return true;
    return digits !== '' && normaliseDigits(o.customer.phone).replace(/\D/g, '').includes(digits);
  });
  hits.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const unique = [...new Set(hits.map((o) => o.orderId))];
  return { ids: unique.slice(0, MAX_SEARCH_ORDER_IDS), truncated: unique.length > MAX_SEARCH_ORDER_IDS };
}
