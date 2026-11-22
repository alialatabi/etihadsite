import 'server-only';
/**
 * Supabase StorageAdapter (`STORAGE=supabase`) for serverless hosting (Vercel has no disk).
 *
 *   Postgres  public.orders (order_id, created_at, record jsonb), public.settings (id=1, data jsonb),
 *             rpc patch_order(p_id, p_patch) for atomic status/notified updates,
 *             public.events (analytics), public.customers + rpc upsert_customer (never purged),
 *             public.ai_usage + rpc reserve_ai / release_ai, public.ai_generations, public.ai_blocks
 *   Storage   private bucket `etihad`: uploads/<id>.bin + .json, orders/<id>.pdf
 *
 * Schema: supabase/migrations/*.sql. RLS is on with no policies, so only the SECRET key
 * (server only, never sent to the browser) can read or write. Plain fetch, no SDK.
 *
 * Failure policy: every call has a timeout, and any outage THROWS (callers answer
 * server_error → the customer gets the WhatsApp fallback). Nothing silently falls back to
 * defaults except a genuinely missing/invalid settings row, so prices never change by accident.
 *
 * Paths match the local adapter (relative, `uploads/…` / `orders/…`) and are validated
 * against a strict pattern before any request, so a stored path can never escape the bucket.
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { reportError } from '@/lib/monitoring/report';
import type {
  AiBlock,
  AiGenerationRecord,
  AiKind,
  AiReserveResult,
  AiUsageRow,
  AnalyticsEvent,
  CustomerRecord,
  OrderRecord,
  ShopSettings,
  StorageAdapter,
  StoredFileMeta,
} from '@/lib/types';
import { ID_RE, designPathsOf, metaPathForDesign, pdfPath, uploadMetaPath, uploadPath } from './paths';
import { purgeBounds } from './purge-rules';
import { parseStoredSettings } from './settings-schema';

const BUCKET = 'etihad';
const PATH_RE = /^(uploads|orders)\/[A-Za-z0-9_-]{8,64}\.(bin|json|pdf)$/;
/** Bucket hard limit (migration). Direct uploads above it cannot be stored. */
export const SUPABASE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const OBJECT_TIMEOUT_MS = 30_000;
/** Page size of every paged listing: PostgREST selects (one response is capped at max-rows, default 1000) and the Storage object list. */
const PAGE_ROWS = 1000;
/** Object paths per bulk-delete request. */
const DELETE_CHUNK = 500;
/** Order ids per retention row-delete request (keeps the URL short even with long ids). */
const ORDER_DELETE_CHUNK = 100;
/** Design paths per "still used by a kept order?" query of the retention purge (keeps the URL short). */
const DESIGN_CHECK_CHUNK = 50;
/** Hard ceiling on pages of an until-empty read: a server that never answers an empty page must end in an error, never a loop (before any delete). */
const MAX_PURGE_PAGES = 10_000;
/** The `limit=` sent on the dry-run purge select of event ids (it counts what would be deleted); PostgREST's max-rows (default 1000) caps the rows actually read. */
const DRY_RUN_COUNT_LIMIT = 100_000;
/** A direct upload that was never committed (.bin without .json) is removed once it is this old. */
const ORPHAN_UPLOAD_MAX_AGE_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const AI_RESERVE_RESULTS: readonly AiReserveResult[] = ['ok', 'ip_limit', 'site_limit', 'blocked'];

function safePath(rel: string): string {
  if (typeof rel !== 'string' || !PATH_RE.test(rel)) throw new Error('Invalid storage path');
  return rel;
}

/** Storage answers "not found" as 404, or as 400 with `{ statusCode: "404" }` / `error: "not_found"`. */
async function isNotFound(res: Response): Promise<boolean> {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const body = (await res.clone().json()) as { statusCode?: string | number; error?: string };
    return String(body.statusCode) === '404' || body.error === 'not_found';
  } catch {
    return false;
  }
}

interface ListedObject {
  name: string;
  created_at?: string;
}

/** AnalyticsEvent → public.events row: an absent optional field is written as an explicit null. */
function eventToRow(e: AnalyticsEvent) {
  return {
    ts: e.ts,
    type: e.type,
    visitor: e.visitor,
    path: e.path ?? null,
    step: e.step ?? null,
    source: e.source ?? null,
    device: e.device ?? null,
    city: e.city ?? null,
    region: e.region ?? null,
    country: e.country ?? null,
    meta: e.meta ?? null,
  };
}

/** public.events row → AnalyticsEvent: null columns are dropped (those fields are optional). */
function rowToEvent(r: Record<string, unknown>): AnalyticsEvent {
  // Filled key by key, in the row's own order; the select list is exactly the event's fields.
  const ev = {} as AnalyticsEvent & Record<string, unknown>;
  for (const [k, v] of Object.entries(r)) if (v !== null) ev[k] = v;
  return ev;
}

/** public.customers row → CustomerRecord. */
function rowToCustomer(r: Record<string, unknown>): CustomerRecord {
  const out: CustomerRecord = {
    phone: String(r.phone),
    governorate: String(r.governorate),
    district: String(r.district),
    landmark: String(r.landmark),
    firstOrderAt: String(r.first_order_at),
    lastOrderAt: String(r.last_order_at),
    ordersCount: Number(r.orders_count),
    totalIqd: Number(r.total_iqd),
    lastOrderId: String(r.last_order_id),
    lastDisplayNo: String(r.last_display_no),
  };
  if (typeof r.name === 'string' && r.name) out.name = r.name;
  // Present once migration 20261122000000 is applied (select=* then returns the columns); older rows/databases have none.
  if (typeof r.marketing_opt_in === 'boolean') {
    out.marketingOptIn = r.marketing_opt_in;
    out.marketingOptInAt = typeof r.marketing_opt_in_at === 'string' ? r.marketing_opt_in_at : null;
  }
  return out;
}

/** AiGenerationRecord → public.ai_generations row. */
function generationToRow(g: AiGenerationRecord) {
  return {
    id: g.id,
    created_at: g.createdAt,
    day: g.day,
    ip: g.ip,
    ip_key: g.ipKey,
    shape: g.shape,
    corners: g.corners,
    width_um: g.widthUm,
    height_um: g.heightUm,
    idea: g.idea,
    lines: g.lines,
    has_refs: g.hasRefs,
    model: g.model,
    upload_id: g.uploadId,
    order_id: g.orderId,
  };
}

/** public.ai_generations row → AiGenerationRecord. */
function rowToGeneration(r: Record<string, unknown>): AiGenerationRecord {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    day: String(r.day),
    ip: String(r.ip ?? ''),
    ipKey: String(r.ip_key ?? ''),
    shape: r.shape as AiGenerationRecord['shape'],
    corners: r.corners as AiGenerationRecord['corners'],
    widthUm: Number(r.width_um),
    heightUm: Number(r.height_um),
    idea: String(r.idea ?? ''),
    lines: Array.isArray(r.lines) ? r.lines.map(String) : [],
    hasRefs: r.has_refs === true,
    model: String(r.model ?? ''),
    uploadId: String(r.upload_id),
    orderId: typeof r.order_id === 'string' ? r.order_id : null,
  };
}

/** PostgREST `Content-Range: 0-47/123` (or a star before the slash on an empty page) → 123; 0 when absent. */
function totalFromContentRange(res: Response): number {
  const m = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
  return m ? Number(m[1]) : 0;
}

export class SupabaseStorage implements StorageAdapter {
  private readonly base: string;
  readonly directUploadMaxBytes = SUPABASE_MAX_UPLOAD_BYTES;
  /** The v1 fallback of upsertCustomerFromOrder logs once per instance. */
  private warnedNoCustomerV2 = false;

  constructor(
    url: string,
    private readonly key: string,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  /**
   * One request. Throws on network errors, timeouts and non-2xx answers, except a
   * "not found" when `allowNotFound` (then the Response is returned with ok === false), and
   * never for a non-2xx status when `anyStatus` (the caller reads `res.ok`; a network error still throws).
   */
  private async req(
    path: string,
    init: RequestInit & { allowNotFound?: boolean; allowStatus?: number; anyStatus?: boolean; timeoutMs?: number } = {},
  ): Promise<Response> {
    const { allowNotFound, allowStatus, anyStatus, timeoutMs, ...rest } = init;
    const res = await fetch(`${this.base}${path}`, {
      ...rest,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, ...((rest.headers as Record<string, string>) ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs ?? TIMEOUT_MS),
    });
    if (res.ok || res.status === allowStatus || anyStatus) return res;
    if (allowNotFound && (await isNotFound(res))) return res;
    const text = await res.text().catch(() => '');
    throw new Error(`[supabase] ${rest.method ?? 'GET'} ${path.split('?')[0]} -> ${res.status} ${text.slice(0, 200)}`);
  }

  /** JSON request body; `prefer` adds a PostgREST `Prefer` header after the content type. */
  private json(body: unknown, prefer?: string): RequestInit {
    return { headers: { 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: JSON.stringify(body) };
  }

  /**
   * Every row of a PostgREST select. One response is capped (max-rows, default 1000), so the
   * rows are fetched page after page with Range headers until a short page arrives.
   * `untilEmpty` (retention reads, where a missing row means a wrongly deleted file): the next
   * page starts after the rows actually received, and only an EMPTY page ends the read, so a
   * server cap below PAGE_ROWS can never cut the list short.
   */
  private async selectAllPaged<T = Record<string, unknown>>(
    pathAndQuery: string,
    opts: { untilEmpty?: boolean; map?: (r: Record<string, unknown>) => T } = {},
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0, pages = 0; ; ) {
      if (opts.untilEmpty && ++pages > MAX_PURGE_PAGES) throw new Error('[supabase] select: page ceiling reached');
      const res = await this.req(pathAndQuery, {
        headers: { Range: `${from}-${from + PAGE_ROWS - 1}`, 'Range-Unit': 'items' },
        timeoutMs: OBJECT_TIMEOUT_MS,
      });
      const page = (await res.json()) as Record<string, unknown>[];
      if (!Array.isArray(page)) throw new Error('[supabase] select: unexpected answer');
      // Each page is converted before the next one is requested.
      if (opts.map) for (const r of page) rows.push(opts.map(r));
      else rows.push(...(page as T[]));
      if (opts.untilEmpty ? page.length === 0 : page.length < PAGE_ROWS) return rows;
      from += opts.untilEmpty ? page.length : PAGE_ROWS;
    }
  }

  /* ───────────── objects ───────────── */

  private async putObject(rel: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.req(`/storage/v1/object/${BUCKET}/${safePath(rel)}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' },
      body: typeof body === 'string' ? body : (body as BodyInit), // fetch copies the bytes itself
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
  }

  private async getObject(rel: string): Promise<Uint8Array | null> {
    const res = await this.req(`/storage/v1/object/authenticated/${BUCKET}/${safePath(rel)}`, {
      allowNotFound: true,
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async saveUpload(uploadId: string, bytes: Uint8Array, meta: StoredFileMeta): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    await this.putObject(uploadPath(uploadId), bytes, 'application/octet-stream');
    await this.putObject(uploadMetaPath(uploadId), JSON.stringify(meta), 'application/json');
    return uploadPath(uploadId);
  }

  async saveUploadMeta(uploadId: string, meta: StoredFileMeta): Promise<void> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    await this.putObject(uploadMetaPath(uploadId), JSON.stringify(meta), 'application/json');
  }

  async readUpload(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    // Meta first: it only exists once the server has checked the bytes.
    const metaRaw = await this.getObject(uploadMetaPath(uploadId));
    if (!metaRaw) return null;
    const bin = await this.getObject(uploadPath(uploadId));
    if (!bin) return null;
    try {
      return { bytes: bin, meta: JSON.parse(Buffer.from(metaRaw).toString('utf8')) as StoredFileMeta };
    } catch (e) {
      // The meta file exists but is not JSON: the customer sees "upload missing"; the owner must know.
      reportError(e, { where: 'storage.readUpload', tags: { uploadId } });
      return null;
    }
  }

  /**
   * Meta and .bin size of a committed upload, without downloading the .bin (see StorageAdapter.uploadInfo).
   * Any answer that is not a clean 2xx with a usable body (404, Storage's 400 with an inner 404, 5xx, a body
   * that is not JSON, no size) is "unknown" and gives null: the caller then asks readUpload, which decides
   * (and throws on a real outage, exactly as before uploadInfo existed). Only a thrown network error propagates.
   */
  async uploadInfo(uploadId: string) {
    if (!ID_RE.test(uploadId)) return null;
    const metaRes = await this.req(`/storage/v1/object/authenticated/${BUCKET}/${safePath(uploadMetaPath(uploadId))}`, {
      anyStatus: true,
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
    if (!metaRes.ok) return this.uploadInfoUnknown(uploadId, 'meta', metaRes);
    let meta: StoredFileMeta;
    try {
      meta = JSON.parse(Buffer.from(await metaRes.arrayBuffer()).toString('utf8')) as StoredFileMeta;
    } catch (e) {
      reportError(e, { where: 'storage.uploadInfo', tags: { uploadId } });
      return null;
    }
    if (typeof meta !== 'object' || meta === null) return null;
    // Object info (JSON, no body): a purged .bin answers 404 and so the caller treats the upload as missing, like readUpload.
    const res = await this.req(`/storage/v1/object/info/authenticated/${BUCKET}/${safePath(uploadPath(uploadId))}`, { anyStatus: true });
    if (!res.ok) return this.uploadInfoUnknown(uploadId, 'info', res);
    const info = (await res.json().catch(() => null)) as { size?: unknown } | null;
    if (typeof info?.size !== 'number' || !Number.isFinite(info.size) || info.size < 0) return null;
    return { meta, size: info.size };
  }

  /** A non-2xx answer of uploadInfo: null. A clean "not found" is the normal case; anything else is also reported (status only). */
  private async uploadInfoUnknown(uploadId: string, call: 'meta' | 'info', res: Response): Promise<null> {
    if (!(await isNotFound(res))) {
      reportError(new Error(`[supabase] uploadInfo ${call} -> ${res.status}`), { where: 'storage.uploadInfo', tags: { uploadId }, level: 'warning' });
    }
    return null;
  }

  async savePdf(orderId: string, bytes: Uint8Array): Promise<string> {
    if (!ID_RE.test(orderId)) throw new Error('Invalid order id');
    await this.putObject(pdfPath(orderId), bytes, 'application/pdf');
    return pdfPath(orderId);
  }

  readFile(rel: string): Promise<Uint8Array | null> {
    return this.getObject(rel);
  }

  async deleteFile(rel: string): Promise<void> {
    await this.deleteMany([safePath(rel)]);
  }

  private async deleteMany(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
      const chunk = paths.slice(i, i + DELETE_CHUNK).map(safePath);
      await this.req(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', ...this.json({ prefixes: chunk }) });
    }
  }

  /**
   * Browser → bucket upload (Vercel caps request bodies at 4.5 MB). Returns a one-time
   * signed PUT URL for uploads/<id>.bin (no upsert: a second PUT is refused). The bucket's
   * size limit applies; the server validates the bytes before writing the meta.
   */
  async createDirectUpload(uploadId: string): Promise<string> {
    if (!ID_RE.test(uploadId)) throw new Error('Invalid upload id');
    const res = await this.req(`/storage/v1/object/upload/sign/${BUCKET}/${uploadPath(uploadId)}`, {
      method: 'POST',
      ...this.json({}),
    });
    const { url } = (await res.json()) as { url?: string };
    if (!url || !url.startsWith('/object/upload/sign/') || !url.includes('token=')) {
      throw new Error('[supabase] bad signed upload url');
    }
    return `${this.base}/storage/v1${url}`;
  }

  /** Short-lived signed download URL (admin only; Vercel caps response bodies at 4.5 MB). */
  async signedDownloadUrl(rel: string, downloadName: string, expiresInSec = 60): Promise<string | null> {
    const res = await this.req(`/storage/v1/object/sign/${BUCKET}/${safePath(rel)}`, {
      method: 'POST',
      ...this.json({ expiresIn: expiresInSec }),
      allowNotFound: true,
    });
    if (!res.ok) return null;
    const { signedURL } = (await res.json()) as { signedURL?: string };
    if (!signedURL || !signedURL.startsWith('/object/sign/') || !signedURL.includes('?token=')) return null;
    return `${this.base}/storage/v1${signedURL}&download=${encodeURIComponent(downloadName)}`;
  }

  /* ───────────── orders ───────────── */

  /**
   * First write wins: a duplicate orderId (a retry that reached another serverless
   * instance) never overwrites the stored record. Later changes go through updateOrder.
   */
  async saveOrder(record: OrderRecord): Promise<void> {
    if (!ID_RE.test(record.orderId)) throw new Error('Invalid order id');
    await this.req('/rest/v1/orders?on_conflict=order_id', {
      method: 'POST',
      ...this.json({ order_id: record.orderId, created_at: record.createdAt, record }, 'resolution=ignore-duplicates,return=minimal'),
    });
  }

  async getOrder(orderId: string): Promise<OrderRecord | null> {
    if (!ID_RE.test(orderId)) return null;
    const res = await this.req(`/rest/v1/orders?select=record&order_id=eq.${encodeURIComponent(orderId)}&limit=1`);
    const rows = (await res.json()) as { record: OrderRecord }[];
    return rows[0]?.record ?? null;
  }

  /** Newest first, at most 1000 (the admin list). */
  async listOrders(): Promise<OrderRecord[]> {
    const res = await this.req('/rest/v1/orders?select=record&order=created_at.desc&limit=1000');
    const rows = (await res.json()) as { record: OrderRecord }[];
    return rows.map((r) => r.record);
  }

  /** Atomic merge in Postgres (rpc patch_order: record = record || patch). */
  async updateOrder(orderId: string, patch: Partial<Pick<OrderRecord, 'status' | 'notified'>>) {
    if (!ID_RE.test(orderId)) return null;
    const clean: Record<string, unknown> = {};
    if (patch.status !== undefined) clean.status = patch.status;
    if (patch.notified !== undefined) clean.notified = patch.notified;
    const res = await this.req('/rest/v1/rpc/patch_order', { method: 'POST', ...this.json({ p_id: orderId, p_patch: clean }) });
    const out = (await res.json()) as OrderRecord | null;
    return out ?? null;
  }

  /* ───────────── settings ───────────── */

  /** Throws on outage. Defaults only when the row is missing or fails validation. */
  async getSettings(): Promise<ShopSettings> {
    const res = await this.req('/rest/v1/settings?select=data&id=eq.1&limit=1');
    const rows = (await res.json()) as { data: unknown }[];
    if (!rows[0]) return structuredClone(DEFAULT_SETTINGS);
    const parsed = parseStoredSettings(rows[0].data);
    if (parsed.ok) return parsed.settings;
    console.error('[storage] stored settings are invalid, using defaults:', parsed.issuePaths);
    // Prices fall back to the defaults here, so this must not go unnoticed (paths only, no values).
    reportError(new Error(`Stored settings are invalid, using defaults: ${parsed.issuePaths}`), {
      where: 'storage.getSettings',
      level: 'warning',
    });
    return structuredClone(DEFAULT_SETTINGS);
  }

  async saveSettings(settings: ShopSettings): Promise<void> {
    await this.req('/rest/v1/settings?on_conflict=id', {
      method: 'POST',
      ...this.json({ id: 1, data: settings, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal'),
    });
  }

  /* ───────────── analytics & customers ───────────── */

  async recordEvent(e: AnalyticsEvent): Promise<void> {
    await this.req('/rest/v1/events', { method: 'POST', ...this.json(eventToRow(e), 'return=minimal') });
  }

  /** Oldest first; pages through PostgREST's 1000-row cap with Range headers. */
  async listEvents(since: Date): Promise<AnalyticsEvent[]> {
    const iso = encodeURIComponent(since.toISOString());
    return this.selectAllPaged(
      `/rest/v1/events?select=ts,type,visitor,path,step,source,device,city,region,country,meta&ts=gte.${iso}&order=ts.asc,id.asc`,
      { map: rowToEvent },
    );
  }

  async upsertCustomerFromOrder(record: OrderRecord): Promise<void> {
    const c = record.customer;
    const args = {
      p_phone: c.phone,
      p_name: c.name ?? null,
      p_governorate: c.governorate,
      p_district: c.district,
      p_landmark: c.landmark,
      p_at: record.createdAt,
      p_order_id: record.orderId,
      p_display_no: record.displayNo,
      p_total_iqd: record.price.totalIqd ?? 0,
    };
    // v2 also records the WhatsApp-offers choice (latest order wins). Until migration 20261122000000 is applied
    // PostgREST answers 404 (PGRST202, function not found): fall back to v1 so the customer is still recorded
    // (the opt-in is then NOT stored: apply the migration before deploying).
    const res = await this.req('/rest/v1/rpc/upsert_customer_v2', {
      method: 'POST',
      allowNotFound: true,
      ...this.json({ ...args, p_marketing_opt_in: c.marketingOptIn === true }),
    });
    if (res.ok) return;
    if (!this.warnedNoCustomerV2) {
      this.warnedNoCustomerV2 = true;
      console.warn('[supabase] upsert_customer_v2 is missing: apply migration 20261122000000_marketing_opt_in.sql');
    }
    await this.req('/rest/v1/rpc/upsert_customer', { method: 'POST', ...this.json(args) });
  }

  async listCustomers(): Promise<CustomerRecord[]> {
    const rows = await this.selectAllPaged('/rest/v1/customers?select=*&order=last_order_at.desc,phone.asc');
    return rows.map(rowToCustomer);
  }

  /** Deletes analytics events older than `cutoff`. Returns `events:<n>` (empty when none). Never touches customers. */
  async purgeEventsOlderThan(cutoff: Date, dryRun: boolean): Promise<string[]> {
    const iso = encodeURIComponent(cutoff.toISOString());
    return this.countOrDelete('events', 'id', `ts=lt.${iso}`, dryRun);
  }

  /** Counts (dry run, up to DRY_RUN_COUNT_LIMIT) or deletes the rows of `table` matching `filter`; returns `<table>:<n>` (empty when none). */
  private async countOrDelete(table: 'events' | 'ai_usage', col: string, filter: string, dryRun: boolean): Promise<string[]> {
    if (dryRun) {
      const res = await this.req(`/rest/v1/${table}?select=${col}&${filter}&limit=${DRY_RUN_COUNT_LIMIT}`);
      const n = ((await res.json()) as unknown[]).length;
      return n ? [`${table}:${n}`] : [];
    }
    const res = await this.req(`/rest/v1/${table}?select=${col}&${filter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    const n = ((await res.json().catch(() => [])) as unknown[]).length;
    return n ? [`${table}:${n}`] : [];
  }

  /* ───────────── AI designer ───────────── */

  /** Atomic in Postgres (rpc reserve_ai, advisory lock per day and kind). Throws on outage or an unexpected answer. */
  async aiReserve(a: { day: string; ipKey: string; ip: string; kind: AiKind; perIpLimit: number; siteLimit: number }) {
    const res = await this.req('/rest/v1/rpc/reserve_ai', {
      method: 'POST',
      ...this.json({ p_day: a.day, p_ip_key: a.ipKey, p_ip: a.ip, p_kind: a.kind, p_per_ip: a.perIpLimit, p_site: a.siteLimit }),
    });
    const out = (await res.json().catch(() => null)) as { status?: unknown; used?: unknown } | null;
    const status = out?.status as AiReserveResult;
    if (!out || !AI_RESERVE_RESULTS.includes(status) || typeof out.used !== 'number') {
      throw new Error('[supabase] reserve_ai: unexpected answer');
    }
    return { status, used: out.used };
  }

  async aiRelease(a: { day: string; ipKey: string; kind: AiKind }): Promise<void> {
    await this.req('/rest/v1/rpc/release_ai', { method: 'POST', ...this.json({ p_day: a.day, p_ip_key: a.ipKey, p_kind: a.kind }) });
  }

  async aiRecordGeneration(rec: AiGenerationRecord): Promise<void> {
    await this.req('/rest/v1/ai_generations', { method: 'POST', ...this.json(generationToRow(rec), 'return=minimal') });
  }

  /** No matching row = no-op. Invalid ids never reach the network. */
  async aiMarkOrdered(uploadId: string, orderId: string): Promise<void> {
    if (!ID_RE.test(uploadId) || !ID_RE.test(orderId)) return;
    await this.req(`/rest/v1/ai_generations?upload_id=eq.${encodeURIComponent(uploadId)}`, {
      method: 'PATCH',
      ...this.json({ order_id: orderId }, 'return=minimal'),
    });
  }

  /** Newest first. One Range page with an exact total; a page past the end (416) is empty. */
  async aiListGenerations(q: { limit: number; offset: number; ipKey?: string }) {
    const from = Math.max(0, Math.floor(q.offset));
    const limit = Math.floor(q.limit);
    const filter = q.ipKey !== undefined ? `&ip_key=eq.${encodeURIComponent(q.ipKey)}` : '';
    if (!(limit >= 1)) {
      // An empty page, but still with the exact total (PostgREST `limit=0` answers `[]` with Content-Range */total).
      const res = await this.req(`/rest/v1/ai_generations?select=id&limit=0${filter}`, {
        headers: { Prefer: 'count=exact' },
        timeoutMs: OBJECT_TIMEOUT_MS,
      });
      return { rows: [], total: totalFromContentRange(res) };
    }
    const to = from + limit - 1;
    const res = await this.req(`/rest/v1/ai_generations?select=*&order=created_at.desc,id.desc${filter}`, {
      headers: { Range: `${from}-${to}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
      allowStatus: 416,
      timeoutMs: OBJECT_TIMEOUT_MS,
    });
    const total = totalFromContentRange(res);
    if (res.status === 416) {
      await res.body?.cancel(); // body not read: release the connection
      return { rows: [], total };
    }
    const rows = (await res.json()) as Record<string, unknown>[];
    return { rows: rows.map(rowToGeneration), total };
  }

  async aiUsage(sinceDay: string, kind?: AiKind): Promise<AiUsageRow[]> {
    if (!DAY_RE.test(sinceDay)) throw new Error('Invalid day');
    if (kind !== undefined && kind !== 'image' && kind !== 'brief') throw new Error('Invalid kind');
    const byKind = kind ? `&kind=eq.${kind}` : '';
    const rows = await this.selectAllPaged(
      `/rest/v1/ai_usage?select=day,ip_key,ip,kind,count,last_at&day=gte.${sinceDay}${byKind}&order=day.asc,ip_key.asc,kind.asc`,
    );
    return rows.map((r) => ({
      day: String(r.day),
      ipKey: String(r.ip_key ?? ''),
      ip: String(r.ip ?? ''),
      kind: r.kind as AiKind,
      count: Number(r.count),
      lastAt: String(r.last_at ?? ''),
    }));
  }

  /** Already blocked = kept as is (first block time stays). */
  async aiBlock(ipKey: string, ip: string): Promise<void> {
    // '' is the site-only usage row; blocking it would block every site-only reservation.
    if (ipKey === '') throw new Error('Invalid ipKey');
    await this.req('/rest/v1/ai_blocks?on_conflict=ip_key', {
      method: 'POST',
      ...this.json({ ip_key: ipKey, ip }, 'resolution=ignore-duplicates,return=minimal'),
    });
  }

  async aiUnblock(ipKey: string): Promise<void> {
    await this.req(`/rest/v1/ai_blocks?ip_key=eq.${encodeURIComponent(ipKey)}`, { method: 'DELETE' });
  }

  async aiListBlocks(): Promise<AiBlock[]> {
    const rows = await this.selectAllPaged('/rest/v1/ai_blocks?select=ip_key,ip,created_at&order=created_at.desc');
    return rows.map((r) => ({ ipKey: String(r.ip_key), ip: String(r.ip ?? ''), createdAt: String(r.created_at) }));
  }

  /** Deletes usage counters of days before `day` (YYYY-MM-DD). Returns `ai_usage:<n>` (empty when none). */
  async aiPurgeUsageBefore(day: string, dryRun: boolean): Promise<string[]> {
    if (!DAY_RE.test(day)) throw new Error('Invalid day');
    return this.countOrDelete('ai_usage', 'day', `day=lt.${day}`, dryRun);
  }

  /* ───────────── retention ───────────── */

  /**
   * Objects under `prefix`, NEWEST first, paged until a page reaches objects created before
   * `from` (everything from `from` on is then listed; a few older ones may come along) or an
   * empty page arrives. A short page does not end the listing (a lower server cap must not hide
   * objects). Objects without a date (folder placeholders) never end the listing.
   */
  private async listPrefixSince(prefix: 'uploads' | 'orders', from: Date): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    for (let offset = 0, pages = 0; ; ) {
      if (++pages > MAX_PURGE_PAGES) throw new Error('[supabase] list: page ceiling reached');
      const res = await this.req(`/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        ...this.json({ prefix, limit: PAGE_ROWS, offset, sortBy: { column: 'created_at', order: 'desc' } }),
      });
      const page = (await res.json()) as ListedObject[];
      if (!Array.isArray(page)) throw new Error('[supabase] list: unexpected answer');
      if (page.length === 0) return out;
      out.push(...page);
      const dated = page.filter((o) => o.created_at);
      const oldest = dated[dated.length - 1]?.created_at;
      if (oldest && new Date(oldest) < from) return out;
      offset += page.length;
    }
  }

  /**
   * Retention purge (Vercel Cron → /api/cron/purge), owner decision D10. New-rule PDFs and
   * uploads are only deleted in the window [cutoff − PURGE_WINDOW_DAYS, cutoff). What is read is
   * wider: every order and ai_generations row created since one day before the window start (no
   * upper bound, to learn which uploads are in use), every old-rule order, and the uploads/ and
   * orders/ listings back to the window start. So the cost follows the activity of the last
   * retentionDays + 31 days (plus the shrinking old-rule leftovers), not all history.
   *   - Orders created before min(cutoff, KEEP_DESIGNS_FROM) (old rule): row, PDF and design are
   *     removed, with NO lower bound, so a purge outage or a lower retentionDays can never strand
   *     a promised deletion (the set only holds what is left from before the switch).
   *   - Orders from KEEP_DESIGNS_FROM on: only their print PDF is removed (when still there, in
   *     the window); the row and the design are kept forever.
   *   - Uploads no order and no ai_generations row uses are removed (in the window); so are
   *     never-committed uploads (.bin without .json) older than `orphanCutoff`.
   * Returns the paths (and `order:<id>` rows) removed, or that would be when dryRun.
   */
  async purgeOlderThan(cutoff: Date, dryRun: boolean, orphanCutoff = new Date(Date.now() - ORPHAN_UPLOAD_MAX_AGE_MS)): Promise<string[]> {
    const { windowStart, oldRuleEnd, inWindow } = purgeBounds(cutoff);
    const oldRuleEndQ = encodeURIComponent(oldRuleEnd.toISOString());
    // References are read from a day before the window: an upload is always older than the
    // order or generation that uses it, and the day covers clocks that disagree.
    const refFromDate = new Date(windowStart.getTime() - DAY_MS);
    const refFrom = encodeURIComponent(refFromDate.toISOString());
    type Row = { order_id: string; created_at: string; files: OrderRecord['files'] | null };
    const windowed = (await this.selectAllPaged(
      `/rest/v1/orders?select=order_id,created_at,files:record->files&created_at=gte.${refFrom}&order=created_at.asc,order_id.asc`,
      { untilEmpty: true },
    )) as Row[];
    // Every old-rule row still there, however old.
    const older = (await this.selectAllPaged(
      `/rest/v1/orders?select=order_id,created_at,files:record->files&created_at=lt.${oldRuleEndQ}&order=created_at.asc,order_id.asc`,
      { untilEmpty: true },
    )) as Row[];
    const seen = new Set(windowed.map((o) => o.order_id));
    const orders = [...windowed, ...older.filter((o) => !seen.has(o.order_id))];
    const ai = (await this.selectAllPaged(
      `/rest/v1/ai_generations?select=upload_id&created_at=gte.${refFrom}&order=created_at.asc,id.asc`,
      { untilEmpty: true },
    )) as { upload_id: string | null }[];
    const uploads = await this.listPrefixSince('uploads', windowStart);
    const pdfs = new Set((await this.listPrefixSince('orders', windowStart)).map((o) => `orders/${o.name}`));

    const oldRule: typeof orders = [];
    const pdfOnly: typeof orders = [];
    const used = new Set<string>();
    for (const o of orders) {
      const created = new Date(o.created_at);
      // An id that could not be put in the delete request safely is never classified for deletion.
      if (created < oldRuleEnd && ID_RE.test(o.order_id)) oldRule.push(o);
      else {
        if (inWindow(created)) pdfOnly.push(o);
        if (o.files?.designPath) for (const d of designPathsOf(o.files)) used.add(d);
      }
    }
    for (const g of ai) if (g.upload_id && ID_RE.test(g.upload_id)) used.add(uploadPath(g.upload_id));
    // Kept orders are those from `oldRuleEnd` on. When that is before `refFrom` (the switch lies
    // further back than the reference window), the read above misses the older kept ones, so an
    // old-rule design that one of them still uses is asked for by path before it is deleted.
    // Otherwise every kept order is already in `used` and nothing is asked.
    const unsure =
      oldRuleEnd < refFromDate
        ? [...new Set(oldRule.flatMap((o) => (o.files?.designPath ? designPathsOf(o.files) : [])).filter((d) => PATH_RE.test(d) && !used.has(d)))]
        : [];
    for (let i = 0; i < unsure.length; i += DESIGN_CHECK_CHUNK) {
      const list = unsure.slice(i, i + DESIGN_CHECK_CHUNK).map((d) => encodeURIComponent(`"${d}"`)).join(',');
      const keptUses = (await this.selectAllPaged(
        `/rest/v1/orders?select=files:record->files&created_at=gte.${oldRuleEndQ}&record->files->>designPath=in.(${list})&order=order_id.asc`,
        { untilEmpty: true },
      )) as { files: OrderRecord['files'] | null }[];
      for (const k of keptUses) if (k.files?.designPath) used.add(k.files.designPath);
    }
    // A kept MULTI-design order may use a path as one of its other designs (files.designPaths), which the
    // designPath lookup above cannot see. Asked only when a multi-design order exists among the orders read
    // (so a store without any keeps the exact requests it always made): one request per still-unsure path,
    // jsonb containment on the list, and the match is tested here too (a row that does not list the path
    // proves nothing, so it is ignored).
    if (unsure.length > 0 && orders.some((o) => o.files?.designPaths)) {
      for (const d of unsure) {
        if (used.has(d)) continue;
        const holders = (await this.selectAllPaged(
          `/rest/v1/orders?select=files:record->files&created_at=gte.${oldRuleEndQ}&record->files->designPaths=cs.${encodeURIComponent(JSON.stringify([d]))}&order=order_id.asc`,
          { untilEmpty: true },
        )) as { files: OrderRecord['files'] | null }[];
        for (const h of holders) if (h.files?.designPaths?.includes(d)) used.add(d);
      }
    }

    const removed: string[] = [];
    const files = new Set<string>();
    for (const o of oldRule) {
      if (o.files?.pdfPath && PATH_RE.test(o.files.pdfPath)) files.add(o.files.pdfPath);
      if (o.files?.designPath) {
        for (const d of designPathsOf(o.files)) {
          if (!PATH_RE.test(d) || used.has(d)) continue;
          files.add(d);
          files.add(metaPathForDesign(d));
        }
      }
      removed.push(`order:${o.order_id}`);
    }
    for (const o of pdfOnly) {
      const p = o.files?.pdfPath;
      if (p && PATH_RE.test(p) && pdfs.has(p)) files.add(p);
    }

    const names = new Set(uploads.map((u) => u.name));
    for (const u of uploads) {
      if (!u.name.endsWith('.bin')) continue;
      const rel = `uploads/${u.name}`;
      if (!PATH_RE.test(rel) || used.has(rel)) continue;
      const created = u.created_at ? new Date(u.created_at) : null;
      if (!created || created < windowStart) continue;
      const committed = names.has(metaPathForDesign(u.name));
      if (created < cutoff || (!committed && created < orphanCutoff)) {
        files.add(rel);
        if (committed) files.add(metaPathForDesign(rel));
      }
    }
    // Orphan metas (bin already gone) in the window.
    for (const u of uploads) {
      if (!u.name.endsWith('.json')) continue;
      const rel = `uploads/${u.name}`;
      const bin = u.name.replace(/\.json$/, '.bin');
      const created = u.created_at ? new Date(u.created_at) : null;
      if (PATH_RE.test(rel) && created && inWindow(created) && !names.has(bin) && !used.has(`uploads/${bin}`)) files.add(rel);
    }

    removed.push(...files);
    if (!dryRun) {
      await this.deleteMany([...files]);
      // Exactly the rows classified above, by id; `created_at < oldRuleEnd` stays on as a backstop.
      for (let i = 0; i < oldRule.length; i += ORDER_DELETE_CHUNK) {
        const ids = oldRule.slice(i, i + ORDER_DELETE_CHUNK).map((o) => o.order_id).join(',');
        await this.req(`/rest/v1/orders?order_id=in.(${ids})&created_at=lt.${oldRuleEndQ}`, { method: 'DELETE' });
      }
    }
    return removed;
  }
}
